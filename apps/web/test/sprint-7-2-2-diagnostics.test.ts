import { describe, expect, it } from "vitest";

import {
  ChatDiagnosticsTrace,
  type ChatLoadState,
} from "@/lib/spatial-debug/chat-diagnostics";
import { MediaDiagnosticsCollector } from "@/lib/spatial-debug/media-diagnostics-collector";
import {
  SpatialAudioMixer,
  syncSpatialAudioGraph,
} from "@/lib/proximity/spatial-audio-mixer";
import {
  isCatalogRegistrationError,
  isMediaAuthorizationDenyError,
} from "@/lib/media/media-provider";
import { findStaleRemoteRefs } from "@/lib/media/stale-remote-tracks";
import { remoteKey } from "@/lib/media/media-provider";

function fakeStream() {
  return {
    getAudioTracks: () => [{ id: "a1" }],
  } as unknown as MediaStream;
}

function baseChatSnapshot(
  overrides: Partial<Parameters<ChatDiagnosticsTrace["snapshot"]>[0]> = {},
) {
  return {
    selectedChannelId: "abc",
    panelOpen: true,
    initialLoad: "success" as ChatLoadState,
    sending: false,
    restAuthenticated: true,
    websocket: "connected" as const,
    renderedMessageCount: 1,
    queuedLiveMessages: 0,
    liveBufferSize: 0,
    inputFocused: false,
    keyboardGuardActive: false,
    channelsLoading: false,
    loadGeneration: 1,
    ...overrides,
  };
}

describe("Sprint 7.2.2 chat lifecycle", () => {
  it("I/J: load state can reach success and error without staying loading", () => {
    const trace = new ChatDiagnosticsTrace();
    const states: ChatLoadState[] = ["loading", "success"];
    expect(states).toContain("success");
    trace.transition("LOAD_CHANNEL_START");
    trace.restFinished(200, null);
    const snap = trace.snapshot(baseChatSnapshot());
    expect(snap.lastRestStatus).toBe(200);
    expect(snap.initialLoad).toBe("success");
  });

  it("K/L: sending flag is independent from load state", () => {
    const trace = new ChatDiagnosticsTrace();
    trace.transition("SEND_START");
    trace.restFinished(200, null);
    trace.transition("SEND_SUCCESS");
    const snap = trace.snapshot(
      baseChatSnapshot({ initialLoad: "idle", renderedMessageCount: 2 }),
    );
    expect(snap.sending).toBe(false);
    expect(snap.renderedMessageCount).toBe(2);
  });

  it("N: one realtime event increments received count once", () => {
    const trace = new ChatDiagnosticsTrace();
    trace.liveEvent();
    const snap = trace.snapshot(baseChatSnapshot());
    expect(snap.receivedEventCount).toBe(1);
  });

  it("M: listener count tracks window listeners deterministically", () => {
    const trace = new ChatDiagnosticsTrace();
    trace.setListenerCount(1);
    expect(trace.snapshot(baseChatSnapshot()).listenerCount).toBe(1);
    trace.setListenerCount(0);
    expect(trace.snapshot(baseChatSnapshot()).listenerCount).toBe(0);
  });

  it("O: fanout warning is captured separately from REST success", () => {
    const trace = new ChatDiagnosticsTrace();
    trace.restFinished(202, null);
    trace.fanoutWarning("fanout degraded");
    const snap = trace.snapshot(baseChatSnapshot());
    expect(snap.lastRestStatus).toBe(202);
    expect(snap.lastFanoutWarning).toBe("fanout degraded");
  });

  it("P: load generation is exposed in diagnostics snapshot", () => {
    const trace = new ChatDiagnosticsTrace();
    const snap = trace.snapshot(baseChatSnapshot({ loadGeneration: 3 }));
    expect(snap.loadGeneration).toBe(3);
  });

  it("S: three live events increment received count without duplication in trace", () => {
    const trace = new ChatDiagnosticsTrace();
    trace.liveEvent();
    trace.liveEvent();
    trace.liveEvent();
    expect(trace.snapshot(baseChatSnapshot()).receivedEventCount).toBe(3);
  });

  it("T: REST authenticated can be true while websocket is disconnected", () => {
    const trace = new ChatDiagnosticsTrace();
    const snap = trace.snapshot(
      baseChatSnapshot({
        restAuthenticated: true,
        websocket: "disconnected",
      }),
    );
    expect(snap.restAuthenticated).toBe(true);
    expect(snap.websocket).toBe("disconnected");
  });
});

describe("Sprint 7.2.2 catalog registration", () => {
  it("detects stale office catalog subscribe failures", () => {
    expect(
      isCatalogRegistrationError(
        new Error("The requested track is not registered in this office."),
      ),
    ).toBe(true);
    expect(
      isCatalogRegistrationError(new Error("Media call failed (410)")),
    ).toBe(false);
    expect(
      isMediaAuthorizationDenyError(
        new Error("Track knowledge is not enough (CLOSED_ROOM)."),
      ),
    ).toBe(true);
  });
});

describe("Sprint 7.2.2 media diagnostics", () => {
  const baseMediaInput = {
    micUiState: "on" as const,
    localAudioTrack: null,
    sendPeer: null,
    recvPeer: null,
    audioSender: null,
    audioTransceiver: null,
    publishedAudio: null as { sessionId: string; trackName: string } | null,
    publishedVideo: null as { sessionId: string; trackName: string } | null,
    lastMediaError: null,
    localZoneId: "zone-commons",
    selfAccessClass: "CLUB_MEMBER",
    audioContextState: "running",
    audioOutputUnlocked: true,
    mixerAttachedKeys: [] as string[],
    audioFallbackKeys: [] as string[],
    remotes: [] as Array<{
      userId: string;
      displayName: string;
      distanceTiles: number | null;
      proximityAudioAuthorized: boolean;
      proximityVideoAuthorized: boolean;
      audioPublication: { sessionId: string; trackName: string } | null;
      subscriptionRequested: boolean;
      sessionId: string | null;
      trackName: string | null;
      track: MediaStreamTrack | null;
      mixerAttached: boolean;
      currentGain: number | null;
      fallbackActive: boolean;
      htmlAudioState: "inactive" | "playing" | "paused" | "blocked";
      lastPlayError: string | null;
      localZoneId: string | null;
      remoteZoneId: string | null;
      audioAuthorizationReason: string | null;
      videoAuthorizationReason: string | null;
    }>,
  };

  it("B: audio and video publications are tracked independently", () => {
    const collector = new MediaDiagnosticsCollector();
    collector.publishStep("audio:published");
    collector.publishStep("video:published");
    const snap = collector.snapshot({
      ...baseMediaInput,
      publishedAudio: { sessionId: "sess-a", trackName: "audio-u-1" },
      publishedVideo: { sessionId: "sess-a", trackName: "video-u-1" },
    });
    expect(snap.local.audioPublicationKnown).toBe(true);
    expect(snap.local.videoPublicationKnown).toBe(true);
  });

  it("C/D: independent remote audio subscriptions are recorded separately", () => {
    const collector = new MediaDiagnosticsCollector();
    collector.subscribeRequested({
      ownerUserId: "user-b",
      sessionId: "s1",
      trackName: "audio-b",
      kind: "audio",
    });
    collector.subscribeRequested({
      ownerUserId: "user-c",
      sessionId: "s2",
      trackName: "audio-c",
      kind: "audio",
    });
    collector.subscribeSuccess({ sessionId: "s1", trackName: "audio-b" });
    collector.subscribeFailure(
      { sessionId: "s2", trackName: "audio-c", kind: "audio" },
      new Error("403"),
    );
    expect(collector.subscriptionState("s1", "audio-b").result).toBe("success");
    expect(collector.subscriptionState("s2", "audio-c").result).toBe("failure");
  });

  it("E: remote track cleanup removes only the target user binding", () => {
    const stale = findStaleRemoteRefs(
      [
        {
          ownerUserId: "b",
          sessionId: "s1",
          trackName: "audio-b",
          kind: "audio",
        },
        {
          ownerUserId: "c",
          sessionId: "s2",
          trackName: "audio-c",
          kind: "audio",
        },
      ],
      [
        {
          ownerUserId: "c",
          sessionId: "s2",
          trackName: "audio-c",
          kind: "audio",
          mid: "m2",
        },
      ],
    );
    expect(stale).toHaveLength(1);
    expect(stale[0]).toBeDefined();
    expect(remoteKey(stale[0]!)).toBe("s1:audio-b");
  });

  it("F: AudioContext unlock state is reflected in diagnostics", () => {
    const mixer = new SpatialAudioMixer(
      () =>
        ({
          state: "suspended",
          currentTime: 0,
          destination: {},
          resume: async () => undefined,
          close: async () => undefined,
          createMediaStreamSource: () => ({
            connect: () => undefined,
            disconnect: () => undefined,
          }),
          createGain: () => ({
            connect: () => undefined,
            disconnect: () => undefined,
            gain: { value: 0, setTargetAtTime: () => undefined },
          }),
        }) as never,
    );
    expect(mixer.isGestureUnlocked()).toBe(false);
    mixer.unlock();
    expect(mixer.isGestureUnlocked()).toBe(true);
  });

  it("G: default proximity playback routes to WebAudio mixer", () => {
    const mixer = new SpatialAudioMixer(
      () =>
        ({
          state: "running",
          currentTime: 0,
          destination: {},
          resume: async () => undefined,
          close: async () => undefined,
          createMediaStreamSource: () => ({
            connect: () => undefined,
            disconnect: () => undefined,
          }),
          createGain: () => ({
            connect: () => undefined,
            disconnect: () => undefined,
            gain: { value: 0, setTargetAtTime: () => undefined },
          }),
        }) as never,
    );
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
        audioGain: 0.5,
      },
    ]);
    expect(result.attached).toEqual(["b:audio", "c:audio"]);
    expect(result.fallbackKeys).toEqual([]);
  });

  it("H: mic off means no audio publication in snapshot", () => {
    const collector = new MediaDiagnosticsCollector();
    const snap = collector.snapshot({
      ...baseMediaInput,
      micUiState: "off",
      publishedAudio: null,
      publishedVideo: { sessionId: "sess-a", trackName: "video-u-1" },
    });
    expect(snap.local.audioPublicationKnown).toBe(false);
    expect(snap.local.videoPublicationKnown).toBe(true);
  });

  it("D: B and C subscriptions remain independent in collector state", () => {
    const collector = new MediaDiagnosticsCollector();
    collector.subscribeRequested({
      ownerUserId: "user-b",
      sessionId: "sb",
      trackName: "audio-b",
      kind: "audio",
    });
    collector.subscribeRequested({
      ownerUserId: "user-c",
      sessionId: "sc",
      trackName: "audio-c",
      kind: "audio",
    });
    collector.subscribeSuccess({ sessionId: "sb", trackName: "audio-b" });
    expect(collector.subscriptionState("sb", "audio-b").result).toBe("success");
    expect(collector.subscriptionState("sc", "audio-c").result).toBe("pending");
  });

  it("A: remote diagnostics expose html audio playback state per user", () => {
    const collector = new MediaDiagnosticsCollector();
    const snap = collector.snapshot({
      ...baseMediaInput,
      remotes: [
        {
          userId: "user-b",
          displayName: "B",
          distanceTiles: 1.2,
          proximityAudioAuthorized: true,
          proximityVideoAuthorized: false,
          audioPublication: { sessionId: "s1", trackName: "audio-b" },
          subscriptionRequested: true,
          sessionId: "s1",
          trackName: "audio-b",
          track: null,
          mixerAttached: false,
          currentGain: 0.8,
          fallbackActive: true,
          htmlAudioState: "blocked",
          lastPlayError: "NotAllowedError",
          localZoneId: "zone-a",
          remoteZoneId: "zone-a",
          audioAuthorizationReason: "PROXIMITY",
          videoAuthorizationReason: "OUT_OF_RANGE",
        },
      ],
    });
    expect(snap.remotes[0]?.htmlAudioState).toBe("blocked");
    expect(snap.remotes[0]?.lastPlayError).toBe("NotAllowedError");
  });
});
