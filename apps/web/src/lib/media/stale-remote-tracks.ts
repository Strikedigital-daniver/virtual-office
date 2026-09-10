import type { PublishedTrack } from "@virtual-office/shared";

import { remoteKey, type RemoteTrackRef } from "./media-provider";

export function catalogTrackKeys(tracks: PublishedTrack[]): Set<string> {
  return new Set(
    tracks.map((track) => `${track.sessionId}:${track.trackName}`),
  );
}

/**
 * Remote SFU bindings that no longer match the office track catalog.
 * Covers revoked tracks and reconnects where the same user publishes a new session.
 */
export function findStaleRemoteRefs(
  boundRefs: RemoteTrackRef[],
  catalog: PublishedTrack[],
): RemoteTrackRef[] {
  const keys = catalogTrackKeys(catalog);
  const latestByOwnerKind = new Map<string, PublishedTrack>();
  for (const track of catalog) {
    latestByOwnerKind.set(`${track.ownerUserId}:${track.kind}`, track);
  }

  return boundRefs.filter((ref) => {
    const key = remoteKey(ref);
    if (!keys.has(key)) return true;
    const latest = latestByOwnerKind.get(`${ref.ownerUserId}:${ref.kind}`);
    if (!latest) return true;
    return remoteKey(latest) !== key;
  });
}
