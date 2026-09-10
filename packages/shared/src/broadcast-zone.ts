import {
  zoneDefinition,
  type BroadcastZoneConfig,
  type MapZone,
  type OfficeMap,
} from "./office-map";
import type { BroadcastSpeakerSource } from "./protocol";
import type { SpatialAccessClass } from "./spatial-access";

export const DEFAULT_MAX_BROADCAST_SPEAKERS = 3;

export type BroadcastScope = "room";

export interface BroadcastSpeakerState {
  userId: string;
  source: BroadcastSpeakerSource;
  activatedAt: number;
  activatedByUserId?: string;
}

export interface PlayerBroadcastPresence {
  userId: string;
  inBroadcastZone: boolean;
  broadcastCapacityBlocked: boolean;
  broadcastSpeakerSource: BroadcastSpeakerSource | null;
}

export function isBroadcastZone(zone: MapZone | null): boolean {
  return zone?.zoneType === "broadcast";
}

export function broadcastConfigForZone(
  zone: MapZone | null,
): BroadcastZoneConfig | null {
  if (!zone || !isBroadcastZone(zone)) return null;
  return (
    zone.broadcastConfig ?? {
      scope: "room",
      maxSpeakers: DEFAULT_MAX_BROADCAST_SPEAKERS,
      audio: true,
      video: false,
    }
  );
}

export function canBroadcastByZone(accessClass: SpatialAccessClass): boolean {
  return accessClass === "CLUB_MEMBER" || accessClass === "RECUERDA_STAFF";
}

export function canBeManualSpeakerTarget(
  accessClass: SpatialAccessClass,
): boolean {
  return accessClass === "CLUB_MEMBER" || accessClass === "RECUERDA_STAFF";
}

export function canModerateManualSpeaker(
  accessClass: SpatialAccessClass,
): boolean {
  return accessClass === "RECUERDA_STAFF";
}

export interface BroadcastAttachmentState {
  userId: string;
  accessClass: SpatialAccessClass;
  zoneId: string | null;
  zoneBroadcastActive: boolean;
  manualBroadcastSpeaker: boolean;
}

export function effectiveBroadcastSpeakerIds(
  attachments: Iterable<BroadcastAttachmentState>,
): Set<string> {
  const ids = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.zoneBroadcastActive || attachment.manualBroadcastSpeaker) {
      ids.add(attachment.userId);
    }
  }
  return ids;
}

export function reconcileZoneBroadcastSpeakers(
  attachments: BroadcastAttachmentState[],
  map: OfficeMap,
): Map<string, { active: boolean; capacityBlocked: boolean }> {
  const result = new Map<
    string,
    { active: boolean; capacityBlocked: boolean }
  >();
  const zone = map.zones.find((entry) => isBroadcastZone(entry)) ?? null;
  const config = broadcastConfigForZone(zone);
  const maxSpeakers = config?.maxSpeakers ?? DEFAULT_MAX_BROADCAST_SPEAKERS;

  const inZoneEligible = attachments.filter((attachment) => {
    const zoneDef = zoneDefinition(map, attachment.zoneId);
    return (
      isBroadcastZone(zoneDef) && canBroadcastByZone(attachment.accessClass)
    );
  });

  const preservedActive = inZoneEligible.filter(
    (attachment) => attachment.zoneBroadcastActive,
  );
  const activeIds = new Set<string>();
  for (const attachment of preservedActive) {
    if (activeIds.size < maxSpeakers) activeIds.add(attachment.userId);
  }

  for (const attachment of inZoneEligible) {
    if (activeIds.has(attachment.userId)) {
      result.set(attachment.userId, { active: true, capacityBlocked: false });
      continue;
    }
    if (activeIds.size < maxSpeakers) {
      activeIds.add(attachment.userId);
      result.set(attachment.userId, { active: true, capacityBlocked: false });
      continue;
    }
    result.set(attachment.userId, { active: false, capacityBlocked: true });
  }

  return result;
}

export function countEffectiveBroadcastSpeakers(
  attachments: Iterable<BroadcastAttachmentState>,
): number {
  return effectiveBroadcastSpeakerIds(attachments).size;
}

export function canActivateManualSpeaker(input: {
  attachments: BroadcastAttachmentState[];
  map: OfficeMap;
  targetUserId: string;
  excludeTarget?: boolean;
}): { allowed: true } | { allowed: false; reason: ManualSpeakerFailureReason } {
  const target = input.attachments.find(
    (attachment) => attachment.userId === input.targetUserId,
  );
  if (!target) {
    return { allowed: false, reason: "TARGET_NOT_FOUND" };
  }
  if (!canBeManualSpeakerTarget(target.accessClass)) {
    return { allowed: false, reason: "TARGET_NOT_ELIGIBLE" };
  }

  const zone = input.map.zones.find((entry) => isBroadcastZone(entry)) ?? null;
  const config = broadcastConfigForZone(zone);
  const maxSpeakers = config?.maxSpeakers ?? DEFAULT_MAX_BROADCAST_SPEAKERS;

  const effective = countEffectiveBroadcastSpeakers(
    input.attachments.filter(
      (attachment) =>
        !input.excludeTarget || attachment.userId !== input.targetUserId,
    ),
  );
  if (target.manualBroadcastSpeaker) {
    return { allowed: true };
  }
  if (effective >= maxSpeakers) {
    return { allowed: false, reason: "BROADCAST_CAPACITY_REACHED" };
  }
  return { allowed: true };
}

export const ManualSpeakerFailureReasonSchema = [
  "NOT_AUTHORIZED",
  "TARGET_NOT_FOUND",
  "TARGET_NOT_ELIGIBLE",
  "BROADCAST_CAPACITY_REACHED",
] as const;

export type ManualSpeakerFailureReason =
  (typeof ManualSpeakerFailureReasonSchema)[number];

export function presenceFromAttachment(
  attachment: BroadcastAttachmentState,
  map: OfficeMap,
): PlayerBroadcastPresence {
  const zoneDef = zoneDefinition(map, attachment.zoneId);
  const inBroadcastZone = isBroadcastZone(zoneDef);
  const source: BroadcastSpeakerSource | null =
    attachment.manualBroadcastSpeaker
      ? "manual"
      : attachment.zoneBroadcastActive
        ? "zone"
        : null;
  return {
    userId: attachment.userId,
    inBroadcastZone,
    broadcastCapacityBlocked:
      inBroadcastZone && canBroadcastByZone(attachment.accessClass) && !source,
    broadcastSpeakerSource: source,
  };
}
