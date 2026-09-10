import type { MediaKind } from "@virtual-office/shared";

import {
  emptyLocalAudioDiagnostics,
  publicationId,
  sanitizeMediaError,
  shortTrackId,
  type LocalAudioDiagnostics,
  type MediaDiagResult,
  type MediaDiagnosticsSnapshot,
  type RemoteAudioDiagnostics,
} from "@/lib/spatial-debug/media-diagnostics";

const MAX_EVENTS = 40;

export class MediaDiagnosticsCollector {
  private events: string[] = [];
  private lastPublishStep: string | null = null;
  private lastPublishError: string | null = null;
  private readonly subscriptionByKey = new Map<
    string,
    { result: MediaDiagResult; error: string | null }
  >();

  log(event: string): void {
    const line = `${new Date().toISOString().slice(11, 23)} ${event}`;
    this.events = [...this.events.slice(-(MAX_EVENTS - 1)), line];
  }

  publishStep(step: string): void {
    this.lastPublishStep = step;
    this.log(`publish:${step}`);
  }

  publishError(error: unknown): void {
    this.lastPublishError = sanitizeMediaError(error);
    this.log(`publish:error ${this.lastPublishError}`);
  }

  subscribeRequested(ref: {
    ownerUserId: string;
    sessionId: string;
    trackName: string;
    kind: MediaKind;
  }): void {
    const key = `${ref.sessionId}:${ref.trackName}`;
    this.subscriptionByKey.set(key, { result: "pending", error: null });
    this.log(`subscribe:req ${ref.kind} user=${ref.ownerUserId.slice(0, 8)}`);
  }

  subscribeSuccess(ref: { sessionId: string; trackName: string }): void {
    const key = `${ref.sessionId}:${ref.trackName}`;
    this.subscriptionByKey.set(key, { result: "success", error: null });
    this.log(`subscribe:ok ${ref.trackName.slice(-12)}`);
  }

  subscribeFailure(
    ref: { sessionId: string; trackName: string; kind: MediaKind },
    error: unknown,
  ): void {
    const key = `${ref.sessionId}:${ref.trackName}`;
    const message = sanitizeMediaError(error);
    this.subscriptionByKey.set(key, { result: "failure", error: message });
    this.log(`subscribe:fail ${ref.kind} ${message}`);
  }

  subscribePendingCleared(ref: { sessionId: string; trackName: string }): void {
    this.log(`subscribe:pending-cleared ${ref.trackName.slice(-12)}`);
  }

  remoteTrack(
    ref: { kind: MediaKind; ownerUserId: string },
    track: MediaStreamTrack,
  ): void {
    this.log(
      `remoteTrack ${ref.kind} user=${ref.ownerUserId.slice(0, 8)} rs=${track.readyState} muted=${track.muted}`,
    );
  }

  subscriptionState(
    sessionId: string,
    trackName: string,
  ): { result: MediaDiagResult; error: string | null } {
    return (
      this.subscriptionByKey.get(`${sessionId}:${trackName}`) ?? {
        result: "idle",
        error: null,
      }
    );
  }

  peerState(label: string, state: string): void {
    this.log(`peer:${label} ${state}`);
  }

  playbackState(
    key: string,
    state: "playing" | "paused" | "blocked",
    error: string | null,
  ): void {
    if (error) {
      this.log(
        `htmlAudio:${key.slice(-12)} ${state} err=${error.slice(0, 80)}`,
      );
    }
  }

  snapshot(input: {
    micUiState: LocalAudioDiagnostics["micUiState"];
    localAudioTrack: MediaStreamTrack | null;
    sendPeer: RTCPeerConnection | null;
    recvPeer: RTCPeerConnection | null;
    audioSender: RTCRtpSender | null;
    audioTransceiver: RTCRtpTransceiver | null;
    publishedAudio: { sessionId: string; trackName: string } | null;
    publishedVideo: { sessionId: string; trackName: string } | null;
    lastMediaError: string | null;
    localZoneId: string | null;
    selfAccessClass: string | null;
    audioContextState: string | null;
    audioOutputUnlocked: boolean;
    mixerAttachedKeys: string[];
    audioFallbackKeys: string[];
    remotes: Array<{
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
      htmlAudioState: RemoteAudioDiagnostics["htmlAudioState"];
      lastPlayError: string | null;
      localZoneId: string | null;
      remoteZoneId: string | null;
      audioAuthorizationReason: string | null;
      videoAuthorizationReason: string | null;
    }>;
  }): MediaDiagnosticsSnapshot {
    const local: LocalAudioDiagnostics = {
      ...emptyLocalAudioDiagnostics(),
      micUiState: input.micUiState,
      getUserMediaTrack: input.localAudioTrack
        ? input.localAudioTrack.readyState === "live"
          ? "live"
          : "ended"
        : "missing",
      trackEnabled: input.localAudioTrack?.enabled ?? null,
      trackMuted: input.localAudioTrack?.muted ?? null,
      senderExists: Boolean(input.audioSender),
      senderTrackPresent: Boolean(input.audioSender?.track),
      senderTrackId: shortTrackId(
        input.audioSender?.track ?? input.localAudioTrack,
      ),
      transceiverDirection: input.audioTransceiver?.direction ?? null,
      sendPeerConnectionState: input.sendPeer?.connectionState ?? null,
      sendSignalingState: input.sendPeer?.signalingState ?? null,
      sendIceConnectionState: input.sendPeer?.iceConnectionState ?? null,
      recvPeerConnectionState: input.recvPeer?.connectionState ?? null,
      recvSignalingState: input.recvPeer?.signalingState ?? null,
      recvIceConnectionState: input.recvPeer?.iceConnectionState ?? null,
      audioPublicationKnown: Boolean(input.publishedAudio),
      audioPublicationId: input.publishedAudio
        ? publicationId(
            input.publishedAudio.sessionId,
            input.publishedAudio.trackName,
            "audio",
          )
        : null,
      videoPublicationKnown: Boolean(input.publishedVideo),
      lastPublishStep: this.lastPublishStep,
      lastPublishError: this.lastPublishError,
      lastMediaError: input.lastMediaError,
      transceiverCount: input.sendPeer?.getTransceivers().length ?? null,
      localZoneId: input.localZoneId,
      selfAccessClass: input.selfAccessClass,
      audioContextState: input.audioContextState,
      audioOutputUnlocked: input.audioOutputUnlocked,
      mixerAttachedKeys: [...input.mixerAttachedKeys],
      audioFallbackKeys: [...input.audioFallbackKeys],
    };

    const remotes: RemoteAudioDiagnostics[] = input.remotes.map((remote) => {
      const sub =
        remote.sessionId && remote.trackName
          ? this.subscriptionState(remote.sessionId, remote.trackName)
          : { result: "idle" as const, error: null };
      return {
        userId: remote.userId,
        displayName: remote.displayName,
        distanceTiles: remote.distanceTiles,
        proximityAudioAuthorized: remote.proximityAudioAuthorized,
        proximityVideoAuthorized: remote.proximityVideoAuthorized,
        audioPublicationKnown: Boolean(remote.audioPublication),
        audioPublicationId: remote.audioPublication
          ? publicationId(
              remote.audioPublication.sessionId,
              remote.audioPublication.trackName,
              "audio",
            )
          : null,
        subscriptionRequested: remote.subscriptionRequested,
        subscriptionResult: sub.result,
        subscriptionError: sub.error,
        remoteAudioTrackReceived: Boolean(remote.track),
        trackReadyState: remote.track?.readyState ?? null,
        trackMuted: remote.track?.muted ?? null,
        trackEnabled: remote.track?.enabled ?? null,
        mixerSourceAttached: remote.mixerAttached,
        gainNodeAttached: remote.mixerAttached,
        currentGain: remote.currentGain,
        fallbackAudioElement: remote.fallbackActive ? "active" : "inactive",
        recvPeerConnectionState: input.recvPeer?.connectionState ?? null,
        lastAudioError: sub.error ?? remote.lastPlayError,
        htmlAudioState: remote.htmlAudioState,
        lastPlayError: remote.lastPlayError,
        localZoneId: remote.localZoneId,
        remoteZoneId: remote.remoteZoneId,
        audioAuthorizationReason: remote.audioAuthorizationReason,
        videoAuthorizationReason: remote.videoAuthorizationReason,
      };
    });

    return {
      capturedAt: new Date().toISOString(),
      local,
      remotes,
      recentEvents: [...this.events],
    };
  }
}
