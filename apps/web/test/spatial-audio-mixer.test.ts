import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  decideProximitySubscription,
  effectiveAudioGain,
  getProximityFactor,
} from "@virtual-office/shared";

import {
  audibleHtmlAudioKeys,
  GAIN_UPDATE_EPSILON,
  proximityAudioOwnerIds,
  shouldMuteRemoteVideoAudio,
  SpatialAudioMixer,
  syncSpatialAudioGraph,
  type SpatialAudioContext,
} from "@/lib/proximity/spatial-audio-mixer";

function fakeStream(): MediaStream {
  return {
    getAudioTracks: () => [{ id: "audio-a" }],
  } as unknown as MediaStream;
}

function fakeContext() {
  const disconnected: string[] = [];
  let sourceCreates = 0;
  const context: SpatialAudioContext & {
    disconnected: string[];
    resume: ReturnType<typeof vi.fn>;
    sourceCreates: () => number;
  } = {
    state: "running",
    currentTime: 0,
    destination: { id: "destination" },
    disconnected,
    resume: vi.fn(async () => undefined),
    sourceCreates: () => sourceCreates,
    close: async () => undefined,
    createMediaStreamSource(stream: MediaStream) {
      sourceCreates += 1;
      return {
        stream,
        connect() {
          return undefined;
        },
        disconnect() {
          disconnected.push("source");
        },
      };
    },
    createGain() {
      const param = {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setTargetAtTime(value: number) {
          param.value = value;
        },
      };
      return {
        gain: param,
        connect() {
          return undefined;
        },
        disconnect() {
          disconnected.push("gain");
        },
      };
    },
  };
  return context;
}

describe("spatial audio gain contract", () => {
  const band = DEFAULT_PROXIMITY_MEDIA_CONFIG.audio;

  it("A: near distance maps to full gain", () => {
    expect(
      effectiveAudioGain({
        remoteMicPublished: true,
        subscribed: true,
        audioFactor: getProximityFactor(0, band),
      }),
    ).toBe(1);
  });

  it("B: just inside the cutoff radius still maps to full gain (hard cutoff, no fade)", () => {
    const justInside = band.fullRadius - 1;
    const gain = effectiveAudioGain({
      remoteMicPublished: true,
      subscribed: true,
      audioFactor: getProximityFactor(justInside, band),
    });
    expect(gain).toBe(1);
  });

  it("C: just past the cutoff radius maps to zero gain (hard cutoff, no fade)", () => {
    const justOutside = band.outerRadius + 1;
    const gain = effectiveAudioGain({
      remoteMicPublished: true,
      subscribed: true,
      audioFactor: getProximityFactor(justOutside, band),
    });
    expect(gain).toBe(0);
  });

  it("D: outside subscription range, unsubscribe still wins over gain", () => {
    const sub = DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription;
    const decision = decideProximitySubscription({
      distance: sub.unsubscribeRadius + 80,
      nowMs: 20_000,
      wasSubscribed: true,
      subscribedSinceMs: 1_000,
      pendingUnsubscribeAtMs: 18_000,
    });
    expect(decision.shouldSubscribe).toBe(false);
    expect(
      effectiveAudioGain({
        remoteMicPublished: true,
        subscribed: decision.shouldSubscribe,
        audioFactor: 1,
      }),
    ).toBe(0);
  });

  it("L: hysteresis is unchanged on the public band", () => {
    const sub = DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription;
    const kept = decideProximitySubscription({
      distance: sub.subscribeRadius + 8,
      nowMs: 5_000,
      wasSubscribed: true,
      subscribedSinceMs: 1_000,
      pendingUnsubscribeAtMs: null,
    });
    expect(kept.shouldSubscribe).toBe(true);
  });
});

describe("SpatialAudioMixer graph lifecycle", () => {
  it("G: uses one AudioContext for many participants", () => {
    let created = 0;
    const mixer = new SpatialAudioMixer(() => {
      created += 1;
      return fakeContext();
    });
    expect(mixer.attach("a", fakeStream())).toBe(true);
    expect(mixer.attach("b", fakeStream())).toBe(true);
    expect(mixer.contextCount()).toBe(1);
    expect(created).toBe(1);
  });

  it("applies GainNode values from the shared attenuation contract", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const stream = fakeStream();
    mixer.attach("near", stream);
    mixer.setGain("near", 1);
    expect(mixer.currentGain("near")).toBe(1);
    mixer.setGain("near", 0.37);
    expect(mixer.currentGain("near")).toBeCloseTo(0.37);
    expect(GAIN_UPDATE_EPSILON).toBeGreaterThan(0);
  });

  it("skips redundant gain writes at proximity tick rate", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    mixer.attach("near", fakeStream());
    mixer.setGain("near", 1);
    mixer.setGain("near", 1);
    mixer.setGain("near", 1.0000001);
    expect(mixer.currentGain("near")).toBe(1);
    mixer.setGain("near", 0);
    expect(mixer.currentGain("near")).toBe(0);
  });

  it("E: position/gain updates reuse the existing graph", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const stream = fakeStream();
    mixer.attach("user-a:audio", stream);
    expect(context.sourceCreates()).toBe(1);
    mixer.setGain("user-a:audio", 0.8);
    mixer.setGain("user-a:audio", 0.4);
    mixer.attach("user-a:audio", stream);
    expect(context.sourceCreates()).toBe(1);
    expect(mixer.attachedKeys()).toEqual(["user-a:audio"]);
  });

  it("F: replacing a track disconnects the previous graph", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const first = fakeStream();
    const second = fakeStream();
    expect(mixer.attach("same", first)).toBe(true);
    expect(mixer.attach("same", second)).toBe(true);
    expect(mixer.attachedKeys()).toEqual(["same"]);
    expect(context.disconnected).toContain("source");
    expect(context.disconnected).toContain("gain");
  });

  it("G: revoking a subscription disconnects the mixer graph", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const stream = fakeStream();
    const remote = {
      key: "user-a:audio",
      stream,
      ref: { kind: "audio", ownerUserId: "user-a" },
      subscribed: true,
      audioGain: 1,
    };
    syncSpatialAudioGraph(mixer, [remote]);
    expect(mixer.attachedKeys()).toEqual(["user-a:audio"]);
    expect(mixer.currentGain("user-a:audio")).toBe(1);

    syncSpatialAudioGraph(mixer, [
      { ...remote, subscribed: false, audioGain: 0 },
    ]);
    expect(mixer.attachedKeys()).toEqual([]);
    expect(mixer.currentGain("user-a:audio")).toBeNull();
    expect(context.disconnected).toEqual(["source", "gain"]);
  });

  it("H: reconnect session replacement keeps exactly one active graph", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const oldRemote = {
      key: "old-session:audio-old",
      stream: fakeStream(),
      ref: { kind: "audio", ownerUserId: "user-b" },
      subscribed: true,
      audioGain: 1,
    };
    const newRemote = {
      key: "new-session:audio-new",
      stream: fakeStream(),
      ref: { kind: "audio", ownerUserId: "user-b" },
      subscribed: true,
      audioGain: 0.9,
    };
    syncSpatialAudioGraph(mixer, [oldRemote]);
    expect(mixer.attachedKeys()).toEqual(["old-session:audio-old"]);
    syncSpatialAudioGraph(mixer, [newRemote]);
    expect(mixer.attachedKeys()).toEqual(["new-session:audio-new"]);
    expect(mixer.has("old-session:audio-old")).toBe(false);
    expect(context.sourceCreates()).toBe(2);
  });

  it("I: multiple participants share one AudioContext with independent gains", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    syncSpatialAudioGraph(mixer, [
      {
        key: "a:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "a" },
        subscribed: true,
        audioGain: 1,
      },
      {
        key: "b:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "b" },
        subscribed: true,
        audioGain: 0.25,
      },
    ]);
    expect(mixer.contextCount()).toBe(1);
    expect(mixer.attachedKeys()).toHaveLength(2);
    expect(mixer.currentGain("a:audio")).toBe(1);
    expect(mixer.currentGain("b:audio")).toBeCloseTo(0.25);
  });

  it("resumes AudioContext on attach via ensurePlayback", () => {
    const context = fakeContext();
    context.state = "suspended";
    const mixer = new SpatialAudioMixer(() => context);
    mixer.attach("a", fakeStream());
    expect(context.resume).toHaveBeenCalledTimes(1);
    mixer.setGain("a", 0.5);
    mixer.unlock();
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("resetAttachments clears nodes but keeps the AudioContext", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    mixer.attach("a", fakeStream());
    expect(mixer.attachedKeys()).toEqual(["a"]);
    expect(context.sourceCreates()).toBe(1);
    mixer.resetAttachments();
    expect(mixer.attachedKeys()).toEqual([]);
    mixer.attach("a", fakeStream());
    expect(context.sourceCreates()).toBe(2);
  });

  it("creates and resumes the context inside the gesture before remote tracks arrive", () => {
    const context = fakeContext();
    context.state = "suspended";
    const factory = vi.fn(() => context);
    const mixer = new SpatialAudioMixer(factory);
    mixer.unlock();
    expect(factory).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    context.state = "running";
    mixer.attach("a", fakeStream());
    mixer.setGain("a", 1);
    for (let key = 0; key < 20; key++) mixer.unlock();
    expect(factory).toHaveBeenCalledOnce();
    expect(context.sourceCreates()).toBe(1);
    expect(mixer.currentGain("a")).toBe(1);
  });

  it("routes proximity audio through WebAudio mixer by default", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const result = syncSpatialAudioGraph(mixer, [
      {
        key: "user-a:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "user-a" },
        subscribed: true,
        audioGain: 1,
      },
    ]);
    expect(result.attached).toEqual(["user-a:audio"]);
    expect(result.fallbackKeys).toEqual([]);
    expect(mixer.attachedKeys()).toEqual(["user-a:audio"]);
  });

  it("J: uses HTML audio only when forceHtmlPlayback is set", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    const result = syncSpatialAudioGraph(
      mixer,
      [
        {
          key: "user-a:audio",
          stream: fakeStream(),
          ref: { kind: "audio", ownerUserId: "user-a" },
          subscribed: true,
          audioGain: 1,
        },
      ],
      { forceHtmlPlayback: true },
    );
    expect(result.attached).toEqual([]);
    expect(result.fallbackKeys).toEqual(["user-a:audio"]);
  });

  it("J: falls back when Web Audio cannot attach a stream", () => {
    const mixer = new SpatialAudioMixer(() => {
      throw new Error("no audio");
    });
    const result = syncSpatialAudioGraph(mixer, [
      {
        key: "user-a:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "user-a" },
        subscribed: true,
        audioGain: 1,
      },
    ]);
    expect(result.attached).toEqual([]);
    expect(result.fallbackKeys).toEqual(["user-a:audio"]);
  });
});

describe("spatial audio playback routing", () => {
  const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("K: video audio is muted when proximity audio is active for that owner", () => {
    const remotes = [
      {
        key: "sess:audio",
        ref: { kind: "audio", ownerUserId: USER },
        subscribed: true,
      },
      {
        key: "sess:video",
        ref: { kind: "video", ownerUserId: USER },
        subscribed: true,
      },
    ];
    const owners = proximityAudioOwnerIds(remotes);
    expect(shouldMuteRemoteVideoAudio(USER, owners)).toBe(true);
  });

  it("K: video stays unmuted when proximity audio is not subscribed", () => {
    const remotes = [
      {
        key: "sess:audio",
        ref: { kind: "audio", ownerUserId: USER },
        subscribed: false,
      },
    ];
    const owners = proximityAudioOwnerIds(remotes);
    expect(shouldMuteRemoteVideoAudio(USER, owners)).toBe(false);
  });
});

describe("warm-up HTML elements for WebAudio (Chromium quirk)", () => {
  const remotes = [
    {
      key: "a:audio",
      ref: { kind: "audio", ownerUserId: "a" },
      subscribed: true,
    },
    {
      key: "b:audio",
      ref: { kind: "audio", ownerUserId: "b" },
      subscribed: true,
    },
    {
      key: "c:audio",
      ref: { kind: "audio", ownerUserId: "c" },
      subscribed: false,
    },
    {
      key: "a:video",
      ref: { kind: "video", ownerUserId: "a" },
      subscribed: true,
    },
  ];

  it("mixer default: no keys audible via HTML (all warm-up muted)", () => {
    const audible = audibleHtmlAudioKeys(remotes, [], false);
    expect(audible.size).toBe(0);
  });

  it("fallback keys stay audible via HTML while mixer handles the rest", () => {
    const audible = audibleHtmlAudioKeys(remotes, ["b:audio"], false);
    expect(audible.has("b:audio")).toBe(true);
    expect(audible.has("a:audio")).toBe(false);
  });

  it("HTML bypass keeps revoked and out-of-range audio excluded", () => {
    const audible = audibleHtmlAudioKeys(remotes, [], true);
    expect([...audible].sort()).toEqual(["a:audio", "b:audio"]);
  });

  it("video tracks never become audible keys", () => {
    const audible = audibleHtmlAudioKeys(remotes, ["c:audio", "a:video"], true);
    expect(audible.has("c:audio")).toBe(false);
    expect(audible.has("a:video")).toBe(false);
  });
});

describe("stale reconnect + mixer contract", () => {
  it("M: stale audio session key is removed when catalog advances", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context);
    syncSpatialAudioGraph(mixer, [
      {
        key: "old-session:audio-old",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "user" },
        subscribed: true,
        audioGain: 1,
      },
    ]);
    syncSpatialAudioGraph(mixer, []);
    expect(mixer.attachedKeys()).toEqual([]);
  });
});
