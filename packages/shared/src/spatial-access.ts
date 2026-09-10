import { OFFICE_ZONE_ID } from "./temple-main-map";
import { zoneDefinition, type MapZone, type OfficeMap } from "./office-map";
import { TILE_SIZE } from "./protocol";

export const SpatialAccessClassSchema = [
  "CLUB_MEMBER",
  "RECUERDA_STAFF",
  "OFFICE_COLLABORATOR",
] as const;

export type SpatialAccessClass = (typeof SpatialAccessClassSchema)[number];

export type SpatialMovementReason =
  "allowed" | "office_entry_denied" | "office_exit_denied";

export function officeFootprint(map: OfficeMap): MapZone | null {
  return zoneDefinition(map, OFFICE_ZONE_ID);
}

/** True when a pixel lies inside the office zone rectangle. */
export function isOfficePixel(map: OfficeMap, x: number, y: number): boolean {
  const office = officeFootprint(map);
  if (!office) return false;
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  return (
    tileX >= office.x &&
    tileX < office.x + office.width &&
    tileY >= office.y &&
    tileY < office.y + office.height
  );
}

export function isOfficeZoneId(zoneId: string | null, map: OfficeMap): boolean {
  if (!zoneId) return false;
  if (zoneId === OFFICE_ZONE_ID) return true;
  const zone = zoneDefinition(map, zoneId);
  const office = officeFootprint(map);
  if (!zone || !office) return false;
  const centerTileX = zone.x + Math.floor(zone.width / 2);
  const centerTileY = zone.y + Math.floor(zone.height / 2);
  return (
    centerTileX >= office.x &&
    centerTileX < office.x + office.width &&
    centerTileY >= office.y &&
    centerTileY < office.y + office.height
  );
}

/**
 * Server-authoritative movement gate for Temple zone boundaries.
 * Zone is derived from map geometry, never from client claims.
 */
export function authorizeSpatialMovement(input: {
  accessClass: SpatialAccessClass;
  destinationX: number;
  destinationY: number;
  map: OfficeMap;
}): { allowed: boolean; reason: SpatialMovementReason } {
  const insideOffice = isOfficePixel(
    input.map,
    input.destinationX,
    input.destinationY,
  );

  if (input.accessClass === "CLUB_MEMBER" && insideOffice) {
    return { allowed: false, reason: "office_entry_denied" };
  }

  if (input.accessClass === "OFFICE_COLLABORATOR" && !insideOffice) {
    return { allowed: false, reason: "office_exit_denied" };
  }

  return { allowed: true, reason: "allowed" };
}

/**
 * Office media requires both parties authorized for office media AND inside
 * the office zone footprint. Club members outside never receive office media.
 */
export function authorizeOfficeMediaPair(input: {
  subscriberAccessClass: SpatialAccessClass;
  publisherAccessClass: SpatialAccessClass;
  subscriberZoneId: string | null;
  publisherZoneId: string | null;
  map: OfficeMap;
}): { allowed: true } | { allowed: false; reason: "OFFICE_MEDIA_PRIVATE" } {
  const publisherInOffice = isOfficeZoneId(input.publisherZoneId, input.map);
  if (!publisherInOffice) return { allowed: true };

  const subscriberInOffice = isOfficeZoneId(input.subscriberZoneId, input.map);
  const subscriberAuthorized =
    input.subscriberAccessClass === "RECUERDA_STAFF" ||
    input.subscriberAccessClass === "OFFICE_COLLABORATOR";

  if (!subscriberInOffice || !subscriberAuthorized) {
    return { allowed: false, reason: "OFFICE_MEDIA_PRIVATE" };
  }

  void input.publisherAccessClass;
  return { allowed: true };
}
