import type { MediaKind, PublishedTrack } from "@virtual-office/shared";

export const MEDIA_REQUEST_TIMEOUT_MS = 15_000;

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
  onLocalTrackClosed?(kind: MediaKind): void;
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
  isRemoteBound(ref: RemoteTrackRef): boolean;
  disconnect(): Promise<void>;
}

export function remoteKey(ref: {
  sessionId: string;
  trackName: string;
}): string {
  return `${ref.sessionId}:${ref.trackName}`;
}

export function isCatalogRegistrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("not registered in this office");
}

/**
 * Remote publication or SFU session no longer exists upstream.
 *
 * "no track mids" is NOT stale: it usually means the publisher's ICE/SDP is
 * not ready yet. Evicting the catalog entry prevents the next retry and is
 * exactly how one side ends up hearing the other forever.
 */
export function isStaleSfuPublicationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\(410\)/u.test(message) || /\(404\)/u.test(message);
}

export function isMediaAuthorizationDenyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("TRACK_NOT_AUTHORIZED") ||
    message.includes("Track knowledge is not enough") ||
    message.includes("CLOSED_ROOM") ||
    message.includes("OFFICE_MEDIA_PRIVATE") ||
    message.includes("FOCUS_RECEIVER")
  );
}
