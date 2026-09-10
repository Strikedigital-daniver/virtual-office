import type { DeskDefinition } from "./room-definition";
import { TILE_SIZE } from "./protocol";
import { TEMPLE_MAIN_ROOM_ID } from "./room-definition";
import type { SpatialAccessClass } from "./spatial-access";

type MapWithDesks = {
  desks?: DeskDefinition[];
};

function desksOnMap(map: MapWithDesks): DeskDefinition[] {
  return map.desks ?? [];
}

/** Max distance from desk interaction point to activate (pixels). */
export const DESK_INTERACTION_RADIUS_PX = TILE_SIZE * 1.75;

export const DeskActivationReasonSchema = [
  "allowed",
  "desk_not_found",
  "office_access_denied",
  "too_far",
  "desk_occupied",
  "already_at_desk",
] as const;

export type DeskActivationReason = (typeof DeskActivationReasonSchema)[number];

export type DeskAssignmentRecord = {
  deskId: string;
  authUserId: string;
  roomId: string;
  worldId: string;
  revokedAt?: string | null;
};

export function deskInteractionTile(desk: DeskDefinition): {
  x: number;
  y: number;
} {
  return {
    x: desk.interactionTileX ?? desk.tileX,
    y: desk.interactionTileY ?? desk.tileY,
  };
}

export function deskInteractionPixel(desk: DeskDefinition): {
  x: number;
  y: number;
} {
  const tile = deskInteractionTile(desk);
  return {
    x: tile.x * TILE_SIZE + TILE_SIZE / 2,
    y: tile.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function findDeskById(
  map: MapWithDesks,
  deskId: string,
): DeskDefinition | null {
  const desks = desksOnMap(map);
  return desks.find((desk) => desk.deskId === deskId) ?? null;
}

export function distanceToDeskInteraction(
  x: number,
  y: number,
  desk: DeskDefinition,
): number {
  const point = deskInteractionPixel(desk);
  return Math.hypot(x - point.x, y - point.y);
}

export function isNearDeskInteraction(
  x: number,
  y: number,
  desk: DeskDefinition,
  radiusPx: number = DESK_INTERACTION_RADIUS_PX,
): boolean {
  return distanceToDeskInteraction(x, y, desk) <= radiusPx;
}

export function nearestDesk(
  map: MapWithDesks,
  x: number,
  y: number,
  radiusPx: number = DESK_INTERACTION_RADIUS_PX,
): DeskDefinition | null {
  let best: DeskDefinition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const desk of desksOnMap(map)) {
    const distance = distanceToDeskInteraction(x, y, desk);
    if (distance <= radiusPx && distance < bestDistance) {
      best = desk;
      bestDistance = distance;
    }
  }
  return best;
}

export function canUseOfficeWorkstations(
  accessClass: SpatialAccessClass,
): boolean {
  return (
    accessClass === "RECUERDA_STAFF" || accessClass === "OFFICE_COLLABORATOR"
  );
}

export function deskPrimaryOccupant(
  deskId: string,
  occupants: Iterable<{ userId: string; currentDeskId: string | null }>,
): string | null {
  for (const entry of occupants) {
    if (entry.currentDeskId === deskId) return entry.userId;
  }
  return null;
}

export function authorizeDeskActivation(input: {
  deskId: string;
  userId: string;
  x: number;
  y: number;
  accessClass: SpatialAccessClass;
  map: MapWithDesks;
  occupants: Iterable<{ userId: string; currentDeskId: string | null }>;
  currentDeskId?: string | null;
}): {
  allowed: boolean;
  reason: DeskActivationReason;
  desk: DeskDefinition | null;
  snapPosition: { x: number; y: number } | null;
} {
  const desk = findDeskById(input.map, input.deskId);
  if (!desk) {
    return {
      allowed: false,
      reason: "desk_not_found",
      desk: null,
      snapPosition: null,
    };
  }

  if (!canUseOfficeWorkstations(input.accessClass)) {
    return {
      allowed: false,
      reason: "office_access_denied",
      desk,
      snapPosition: null,
    };
  }

  if (!isNearDeskInteraction(input.x, input.y, desk)) {
    return {
      allowed: false,
      reason: "too_far",
      desk,
      snapPosition: null,
    };
  }

  const occupant = deskPrimaryOccupant(input.deskId, input.occupants);
  if (occupant && occupant !== input.userId) {
    return {
      allowed: false,
      reason: "desk_occupied",
      desk,
      snapPosition: null,
    };
  }

  if (input.currentDeskId === input.deskId) {
    return {
      allowed: false,
      reason: "already_at_desk",
      desk,
      snapPosition: deskInteractionPixel(desk),
    };
  }

  return {
    allowed: true,
    reason: "allowed",
    desk,
    snapPosition: deskInteractionPixel(desk),
  };
}

/**
 * Resolves active desk assignments against the published map.
 * Missing desks become inactive without throwing.
 */
export function resolveActiveDeskAssignments(
  assignments: DeskAssignmentRecord[],
  map: MapWithDesks,
  roomId: string = TEMPLE_MAIN_ROOM_ID,
): {
  active: DeskAssignmentRecord[];
  orphanedDeskIds: string[];
} {
  const deskIds = new Set(desksOnMap(map).map((desk) => desk.deskId));
  const active: DeskAssignmentRecord[] = [];
  const orphanedDeskIds: string[] = [];

  for (const assignment of assignments) {
    if (assignment.revokedAt) continue;
    if (assignment.roomId !== roomId) continue;
    if (!deskIds.has(assignment.deskId)) {
      orphanedDeskIds.push(assignment.deskId);
      continue;
    }
    active.push(assignment);
  }

  return { active, orphanedDeskIds };
}

export function assignmentForUser(
  assignments: DeskAssignmentRecord[],
  authUserId: string,
): DeskAssignmentRecord | null {
  return (
    assignments.find(
      (row) => row.authUserId === authUserId && !row.revokedAt,
    ) ?? null
  );
}
