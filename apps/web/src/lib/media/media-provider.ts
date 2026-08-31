import type { MediaKind, PublishedTrack } from "@virtual-office/shared";

export interface RemoteTrackRef {
  ownerUserId: string;
  sessionId: string;
  trackName: string;
  kind: MediaKind;
}

export interface MediaProviderCallbacks {
  onRemoteTrack(ref: RemoteTrackRef, track: MediaStreamTrack): void;
  onRemoteTrackClosed(ref: RemoteTrackRef): void;
  onState(state: string): void;
}

/**
 * Domain-facing contract required by the master spec (section 7.3): the UI and
 * the game never talk to Cloudflare Realtime directly, so the transport can be
 * replaced without rewriting controls, Phaser or the zone logic.
 */
export interface MediaProvider {
  connect(): Promise<void>;
  publish(kind: MediaKind, track: MediaStreamTrack): Promise<PublishedTrack>;
  unpublish(kind: MediaKind): Promise<void>;
  subscribe(ref: RemoteTrackRef): Promise<void>;
  unsubscribe(ref: RemoteTrackRef): Promise<void>;
  publishedKinds(): MediaKind[];
  disconnect(): Promise<void>;
}

export function remoteKey(ref: {
  sessionId: string;
  trackName: string;
}): string {
  return `${ref.sessionId}:${ref.trackName}`;
}
