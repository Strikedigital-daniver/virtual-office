import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AVATAR_APPEARANCE,
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  TILE_SIZE,
  decideProximitySubscription,
  effectiveAudioGain,
  getProximityFactor,
} from "@virtual-office/shared";

import {
  appearancesEquivalent,
  interpretAvatarSaveResponse,
} from "@/lib/avatar/persistence";
import {
  buildConversationParticipantSurfaces,
  participantShowsLiveVideo,
  participantTileVideoKey,
} from "@/lib/media/participant-surface";
import type { RemoteMedia } from "@/lib/media/use-office-media";
import {
  SpatialAudioMixer,
  syncSpatialAudioGraph,
} from "@/lib/proximity/spatial-audio-mixer";

function remoteMedia(input: {
  userId: string;
  kind: "audio" | "video";
  subscribed?: boolean;
  videoOpacity?: number;
  key?: string;
}): RemoteMedia {
  return {
    key: input.key ?? `${input.userId}:${input.kind}`,
    ref: {
      ownerUserId: input.userId,
      sessionId: "session",
      trackName: `${input.kind}-${input.userId}`,
      kind: input.kind,
    },
    stream: {
      getAudioTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream,
    displayName: input.userId,
    audioGain: 1,
    videoOpacity: input.videoOpacity ?? 1,
    proximityZone: "FULL",
    subscribed: input.subscribed ?? true,
  };
}

describe("Sprint 7.2.1 participant surface", () => {
  it("A: authorized presence renders B and C tiles", () => {
    const surfaces = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b", "c"],
      remotes: [],
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: () => false,
    });
    expect(surfaces.map((item) => item.userId)).toEqual(["b", "c"]);
  });

  it("B: two independent video bindings stay on separate users", () => {
    const remotes = [
      remoteMedia({ userId: "b", kind: "video", key: "b:video" }),
      remoteMedia({ userId: "c", kind: "video", key: "c:video" }),
    ];
    const surfaces = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b", "c"],
      remotes,
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: (id) => id === "b" || id === "c",
    });
    expect(participantTileVideoKey(surfaces[0]!)).toBe("b:video");
    expect(participantTileVideoKey(surfaces[1]!)).toBe("c:video");
  });

  it("C: B video + C placeholder", () => {
    const surfaces = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b", "c"],
      remotes: [remoteMedia({ userId: "b", kind: "video" })],
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: (id) => id === "b",
    });
    expect(participantShowsLiveVideo(surfaces[0]!)).toBe(true);
    expect(participantShowsLiveVideo(surfaces[1]!)).toBe(false);
  });

  it("D: camera-off participants keep placeholders", () => {
    const surfaces = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b", "c"],
      remotes: [],
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: () => false,
    });
    expect(surfaces.every((item) => !participantShowsLiveVideo(item))).toBe(
      true,
    );
  });

  it("E: leaving B removes only B", () => {
    const first = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b", "c"],
      remotes: [],
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: () => false,
    });
    const second = buildConversationParticipantSurfaces({
      authorizedUserIds: ["c"],
      remotes: [],
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: () => false,
    });
    expect(first.map((item) => item.userId)).toEqual(["b", "c"]);
    expect(second.map((item) => item.userId)).toEqual(["c"]);
  });

  it("F: ended camera track keeps placeholder when still authorized", () => {
    const surfaces = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b"],
      remotes: [],
      displayNameFor: (id) => id,
      micPublishedFor: () => true,
      cameraPublishedFor: () => false,
    });
    expect(surfaces[0]?.micPublished).toBe(true);
    expect(participantShowsLiveVideo(surfaces[0]!)).toBe(false);
  });

  it("G: one participant cannot overwrite another video key", () => {
    const remotes = [
      remoteMedia({ userId: "b", kind: "video", key: "b:video" }),
      remoteMedia({ userId: "c", kind: "video", key: "c:video" }),
    ];
    const surfaces = buildConversationParticipantSurfaces({
      authorizedUserIds: ["b", "c"],
      remotes,
      displayNameFor: (id) => id,
      micPublishedFor: () => false,
      cameraPublishedFor: () => true,
    });
    const keys = surfaces.map((item) => participantTileVideoKey(item));
    expect(new Set(keys).size).toBe(2);
  });
});

describe("Sprint 7.2.1 proximity radii", () => {
  it("uses a 12-tile listen radius and 14-tile drop", () => {
    expect(DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription.subscribeRadius).toBe(
      TILE_SIZE * 12,
    );
    expect(DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription.unsubscribeRadius).toBe(
      TILE_SIZE * 14,
    );
  });
});

describe("Sprint 7.2.1 proximity", () => {
  const sub = DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription;
  const audio = DEFAULT_PROXIMITY_MEDIA_CONFIG.audio;

  it("T: <= 1 tile keeps full gain", () => {
    expect(getProximityFactor(TILE_SIZE, audio)).toBe(1);
  });

  it("U: audio is a hard cutoff at 12 tiles, no fade band", () => {
    const mid = TILE_SIZE * 6;
    expect(getProximityFactor(mid, audio)).toBe(1);
    expect(getProximityFactor(TILE_SIZE * 12, audio)).toBe(1);
    expect(getProximityFactor(TILE_SIZE * 12 + 1, audio)).toBe(0);
  });

  it("V: enters at <= 12 tiles", () => {
    expect(
      decideProximitySubscription(
        {
          distance: TILE_SIZE * 12,
          nowMs: 1,
          wasSubscribed: false,
          subscribedSinceMs: null,
          pendingUnsubscribeAtMs: null,
        },
        sub,
      ).shouldSubscribe,
    ).toBe(true);
  });

  it("W: no disconnect flapping before > 14 tiles", () => {
    const held = decideProximitySubscription(
      {
        distance: TILE_SIZE * 12 + 8,
        nowMs: 5_000,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: null,
      },
      sub,
    );
    expect(held.shouldSubscribe).toBe(true);
  });

  it("X: > 14 tiles unsubscribes after hysteresis", () => {
    const pending = decideProximitySubscription(
      {
        distance: TILE_SIZE * 14 + 4,
        nowMs: 10_000,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: null,
      },
      sub,
    );
    const exited = decideProximitySubscription(
      {
        distance: TILE_SIZE * 14 + 4,
        nowMs: pending.pendingUnsubscribeAtMs! + 1,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: pending.pendingUnsubscribeAtMs,
      },
      sub,
    );
    expect(exited.shouldSubscribe).toBe(false);
  });

  it("audio gain respects mic publication", () => {
    expect(
      effectiveAudioGain({
        remoteMicPublished: false,
        subscribed: true,
        audioFactor: 1,
      }),
    ).toBe(0);
  });
});

describe("Sprint 7.2.1 audio mixer", () => {
  function fakeStream() {
    return {
      getAudioTracks: () => [{ kind: "audio" }],
    } as MediaStream;
  }

  function fakeContext() {
    const disconnected: string[] = [];
    return {
      state: "running",
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createMediaStreamSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(() => disconnected.push("source")),
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(() => disconnected.push("gain")),
        gain: { value: 0, setTargetAtTime: vi.fn() },
      })),
      disconnected,
    };
  }

  it("N/O: two remote users keep independent mixer nodes", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context as never);
    mixer.unlock();
    const result = syncSpatialAudioGraph(mixer, [
      {
        key: "b:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "b" },
        subscribed: true,
        audioGain: 1,
      },
      {
        key: "c:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "c" },
        subscribed: true,
        audioGain: 0.4,
      },
    ]);
    expect(result.attached).toEqual(["b:audio", "c:audio"]);
    expect(mixer.has("b:audio")).toBe(true);
    expect(mixer.has("c:audio")).toBe(true);
  });

  it("P: unsubscribe cleans only the target participant", () => {
    const context = fakeContext();
    const mixer = new SpatialAudioMixer(() => context as never);
    syncSpatialAudioGraph(mixer, [
      {
        key: "b:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "b" },
        subscribed: true,
        audioGain: 1,
      },
      {
        key: "c:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "c" },
        subscribed: true,
        audioGain: 1,
      },
    ]);
    syncSpatialAudioGraph(mixer, [
      {
        key: "c:audio",
        stream: fakeStream(),
        ref: { kind: "audio", ownerUserId: "c" },
        subscribed: true,
        audioGain: 1,
      },
    ]);
    expect(mixer.attachedKeys()).toEqual(["c:audio"]);
  });
});

describe("Sprint 7.2.1 avatar ack", () => {
  const saved = DEFAULT_AVATAR_APPEARANCE;

  it("AA: successful persistence never surfaces false-negative copy", () => {
    expect(
      interpretAvatarSaveResponse({
        ok: true,
        status: 200,
        persisted: true,
        appearance: saved,
      }).synced,
    ).toBe(true);
  });

  it("AB: persisted true without appearance still counts as success", () => {
    expect(
      interpretAvatarSaveResponse({
        ok: true,
        status: 200,
        persisted: true,
      }).synced,
    ).toBe(true);
  });

  it("AC: actual persistence failure stays unsynced", () => {
    expect(
      interpretAvatarSaveResponse({
        ok: false,
        status: 503,
        persisted: false,
      }).synced,
    ).toBe(false);
  });

  it("AD: equivalent appearances compare for reload verification", () => {
    expect(appearancesEquivalent(saved, { ...saved })).toBe(true);
  });
});
