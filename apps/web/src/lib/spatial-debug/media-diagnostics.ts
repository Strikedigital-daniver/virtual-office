import type { MediaKind } from "@virtual-office/shared";

export type MediaDiagResult = "idle" | "pending" | "success" | "failure";

export interface LocalAudioDiagnostics {
  micUiState: "off" | "starting" | "on" | "failed";
  getUserMediaTrack: "missing" | "live" | "ended";
  trackEnabled: boolean | null;
  trackMuted: boolean | null;
  senderExists: boolean;
  senderTrackPresent: boolean;
  senderTrackId: string | null;
  transceiverDirection: string | null;
  sendPeerConnectionState: string | null;
  sendSignalingState: string | null;
  sendIceConnectionState: string | null;
  recvPeerConnectionState: string | null;
  recvSignalingState: string | null;
  recvIceConnectionState: string | null;
  audioPublicationKnown: boolean;
  audioPublicationId: string | null;
  videoPublicationKnown: boolean;
  lastPublishStep: string | null;
  lastPublishError: string | null;
  lastMediaError: string | null;
  transceiverCount: number | null;
  localZoneId: string | null;
  selfAccessClass: string | null;
  audioContextState: string | null;
  audioOutputUnlocked: boolean;
  mixerAttachedKeys: string[];
  audioFallbackKeys: string[];
}

export interface RemoteAudioDiagnostics {
  userId: string;
  displayName: string;
  distanceTiles: number | null;
  proximityAudioAuthorized: boolean;
  proximityVideoAuthorized: boolean;
  audioPublicationKnown: boolean;
  audioPublicationId: string | null;
  subscriptionRequested: boolean;
  subscriptionResult: MediaDiagResult;
  subscriptionError: string | null;
  remoteAudioTrackReceived: boolean;
  trackReadyState: string | null;
  trackMuted: boolean | null;
  trackEnabled: boolean | null;
  mixerSourceAttached: boolean;
  gainNodeAttached: boolean;
  currentGain: number | null;
  fallbackAudioElement: "inactive" | "active";
  recvPeerConnectionState: string | null;
  lastAudioError: string | null;
  htmlAudioState: "inactive" | "playing" | "paused" | "blocked";
  lastPlayError: string | null;
  localZoneId: string | null;
  remoteZoneId: string | null;
  audioAuthorizationReason: string | null;
  videoAuthorizationReason: string | null;
}

export interface MediaDiagnosticsSnapshot {
  capturedAt: string;
  local: LocalAudioDiagnostics;
  remotes: RemoteAudioDiagnostics[];
  recentEvents: string[];
}

export function sanitizeMediaError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 240);
  }
  return String(error).slice(0, 240);
}

export function trackLifecycleLabel(
  track: MediaStreamTrack | null | undefined,
): LocalAudioDiagnostics["getUserMediaTrack"] {
  if (!track) return "missing";
  if (track.readyState === "live") return "live";
  return "ended";
}

export function emptyLocalAudioDiagnostics(): LocalAudioDiagnostics {
  return {
    micUiState: "off",
    getUserMediaTrack: "missing",
    trackEnabled: null,
    trackMuted: null,
    senderExists: false,
    senderTrackPresent: false,
    senderTrackId: null,
    transceiverDirection: null,
    sendPeerConnectionState: null,
    sendSignalingState: null,
    sendIceConnectionState: null,
    recvPeerConnectionState: null,
    recvSignalingState: null,
    recvIceConnectionState: null,
    audioPublicationKnown: false,
    audioPublicationId: null,
    videoPublicationKnown: false,
    lastPublishStep: null,
    lastPublishError: null,
    lastMediaError: null,
    transceiverCount: null,
    localZoneId: null,
    selfAccessClass: null,
    audioContextState: null,
    audioOutputUnlocked: false,
    mixerAttachedKeys: [],
    audioFallbackKeys: [],
  };
}

export function shortTrackId(
  track: MediaStreamTrack | null | undefined,
): string | null {
  if (!track?.id) return null;
  return track.id.slice(-8);
}

export function publicationId(
  sessionId: string,
  trackName: string,
  kind: MediaKind,
): string {
  return `${kind}:${sessionId.slice(0, 6)}:${trackName.slice(-10)}`;
}
