import { zoneAtPixel, type OfficeMap } from "./office-map";
import { OFFICE_MAP } from "./temple-main-map";
import {
  authorizeOfficeMediaPair,
  isOfficePixel,
  type SpatialAccessClass,
} from "./spatial-access";
import {
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  decideProximitySubscription,
  type ProximityMediaConfig,
  type ProximitySubscriptionDecision,
} from "./proximity";

export type SpatialParticipant = {
  x: number;
  y: number;
  zoneId: string | null;
};

export type MediaAuthorizationReason =
  | "NEARBY"
  | "SAME_MEETING"
  | "OUT_OF_RANGE"
  | "CLOSED_ROOM"
  | "FOCUS_RECEIVER"
  | "MISSING_PRESENCE"
  | "OFFICE_MEDIA_PRIVATE"
  | "ROOM_BROADCAST";

export interface MediaAuthorizationOptions {
  trackKind?: "audio" | "video";
  publisherUserId?: string;
  broadcastSpeakerUserIds?: ReadonlySet<string>;
}

export interface MediaAuthorizationDecision {
  allowed: boolean;
  ignoreDistance: boolean;
  reason: MediaAuthorizationReason;
}

export function resolvedZoneId(
  participant: SpatialParticipant,
  map: OfficeMap = OFFICE_MAP,
): string | null {
  return zoneAtPixel(map, participant.x, participant.y);
}

export type MediaPrivacyKind = "deny" | "meeting" | "public";

function zoneSealsMedia(
  zone: { zoneType: string; privacy: string } | undefined,
): boolean {
  if (!zone || zone.privacy !== "room") return false;
  // The office footprint is a container for desks/meeting/focus, not a sealed
  // meeting. Club isolation is authorizeOfficeMediaPair, not CLOSED_ROOM.
  if (zone.zoneType === "office") return false;
  return true;
}

export function evaluateMediaPrivacy(
  subscriber: SpatialParticipant,
  publisher: SpatialParticipant,
  map: OfficeMap = OFFICE_MAP,
): {
  kind: MediaPrivacyKind;
  reason: MediaAuthorizationReason;
} {
  const subscriberZoneId = resolvedZoneId(subscriber, map);
  const publisherZoneId = resolvedZoneId(publisher, map);
  const subscriberZone = map.zones.find(
    (zone) => zone.zoneId === subscriberZoneId,
  );
  const publisherZone = map.zones.find(
    (zone) => zone.zoneId === publisherZoneId,
  );

  if (subscriberZone?.zoneType === "focus") {
    return { kind: "deny", reason: "FOCUS_RECEIVER" };
  }

  const subscriberClosed = zoneSealsMedia(subscriberZone);
  const publisherClosed = zoneSealsMedia(publisherZone);
  if (subscriberClosed || publisherClosed) {
    if (
      subscriberZoneId &&
      subscriberZoneId === publisherZoneId &&
      publisherZone?.zoneType === "meeting"
    ) {
      return { kind: "meeting", reason: "SAME_MEETING" };
    }
    return { kind: "deny", reason: "CLOSED_ROOM" };
  }

  return { kind: "public", reason: "NEARBY" };
}

export function authorizeMediaSubscription(
  subscriber: SpatialParticipant,
  publisher: SpatialParticipant,
  config: ProximityMediaConfig = DEFAULT_PROXIMITY_MEDIA_CONFIG,
  map: OfficeMap = OFFICE_MAP,
  access?: {
    subscriberAccessClass: SpatialAccessClass;
    publisherAccessClass: SpatialAccessClass;
  },
  options?: MediaAuthorizationOptions,
): MediaAuthorizationDecision {
  if (access) {
    const office = authorizeOfficeMediaPair({
      subscriberAccessClass: access.subscriberAccessClass,
      publisherAccessClass: access.publisherAccessClass,
      subscriberZoneId: resolvedZoneId(subscriber, map),
      publisherZoneId: resolvedZoneId(publisher, map),
      map,
    });
    if (!office.allowed) {
      return {
        allowed: false,
        ignoreDistance: false,
        reason: "OFFICE_MEDIA_PRIVATE",
      };
    }
  }

  if (
    options?.trackKind === "audio" &&
    options.publisherUserId &&
    options.broadcastSpeakerUserIds?.has(options.publisherUserId) &&
    !isOfficePixel(map, subscriber.x, subscriber.y)
  ) {
    return {
      allowed: true,
      ignoreDistance: true,
      reason: "ROOM_BROADCAST",
    };
  }

  const privacy = evaluateMediaPrivacy(subscriber, publisher, map);
  if (privacy.kind === "deny") {
    return {
      allowed: false,
      ignoreDistance: false,
      reason: privacy.reason,
    };
  }
  if (privacy.kind === "meeting") {
    return {
      allowed: true,
      ignoreDistance: true,
      reason: "SAME_MEETING",
    };
  }

  const distance = Math.hypot(
    subscriber.x - publisher.x,
    subscriber.y - publisher.y,
  );
  if (distance <= config.subscription.unsubscribeRadius) {
    return { allowed: true, ignoreDistance: false, reason: "NEARBY" };
  }
  return { allowed: false, ignoreDistance: false, reason: "OUT_OF_RANGE" };
}

export interface SpatialSubscriptionInput {
  subscriber: SpatialParticipant;
  publisher: SpatialParticipant;
  nowMs: number;
  wasSubscribed: boolean;
  subscribedSinceMs: number | null;
  pendingUnsubscribeAtMs: number | null;
}

export interface SpatialSubscriptionDecision extends ProximitySubscriptionDecision {
  reason: MediaAuthorizationDecision["reason"] | "HYSTERESIS";
  ignoreDistance: boolean;
}

/**
 * Client subscription planner. Privacy/room/focus changes revoke immediately.
 * Distance hysteresis only applies on the public-range path.
 */
export function decideSpatialSubscription(
  input: SpatialSubscriptionInput,
  config: ProximityMediaConfig = DEFAULT_PROXIMITY_MEDIA_CONFIG,
  map: OfficeMap = OFFICE_MAP,
  access?: {
    subscriberAccessClass: SpatialAccessClass;
    publisherAccessClass?: SpatialAccessClass;
  },
  options?: MediaAuthorizationOptions,
): SpatialSubscriptionDecision {
  if (access?.subscriberAccessClass) {
    const office = authorizeOfficeMediaPair({
      subscriberAccessClass: access.subscriberAccessClass,
      publisherAccessClass: access.publisherAccessClass ?? "RECUERDA_STAFF",
      subscriberZoneId: resolvedZoneId(input.subscriber, map),
      publisherZoneId: resolvedZoneId(input.publisher, map),
      map,
    });
    if (!office.allowed) {
      return {
        shouldSubscribe: false,
        pendingUnsubscribeAtMs: null,
        subscribedSinceMs: null,
        reason: "OFFICE_MEDIA_PRIVATE",
        ignoreDistance: false,
      };
    }
  }

  if (
    options?.trackKind === "audio" &&
    options.publisherUserId &&
    options.broadcastSpeakerUserIds?.has(options.publisherUserId) &&
    !isOfficePixel(map, input.subscriber.x, input.subscriber.y)
  ) {
    return {
      shouldSubscribe: true,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs: input.subscribedSinceMs ?? input.nowMs,
      reason: "ROOM_BROADCAST",
      ignoreDistance: true,
    };
  }

  if (
    options?.trackKind === "audio" &&
    options.publisherUserId &&
    !options.broadcastSpeakerUserIds?.has(options.publisherUserId) &&
    input.wasSubscribed
  ) {
    const distance = Math.hypot(
      input.subscriber.x - input.publisher.x,
      input.subscriber.y - input.publisher.y,
    );
    if (distance > config.subscription.subscribeRadius) {
      return {
        shouldSubscribe: false,
        pendingUnsubscribeAtMs: null,
        subscribedSinceMs: null,
        reason: "OUT_OF_RANGE",
        ignoreDistance: false,
      };
    }
  }

  const privacy = evaluateMediaPrivacy(input.subscriber, input.publisher, map);

  if (privacy.kind === "deny") {
    return {
      shouldSubscribe: false,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs: null,
      reason: privacy.reason,
      ignoreDistance: false,
    };
  }

  if (privacy.kind === "meeting") {
    return {
      shouldSubscribe: true,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs: input.subscribedSinceMs ?? input.nowMs,
      reason: "SAME_MEETING",
      ignoreDistance: true,
    };
  }

  const distance = Math.hypot(
    input.subscriber.x - input.publisher.x,
    input.subscriber.y - input.publisher.y,
  );
  const proximity = decideProximitySubscription(
    {
      distance,
      nowMs: input.nowMs,
      wasSubscribed: input.wasSubscribed,
      subscribedSinceMs: input.subscribedSinceMs,
      pendingUnsubscribeAtMs: input.pendingUnsubscribeAtMs,
    },
    config.subscription,
  );
  return {
    ...proximity,
    ignoreDistance: false,
    reason: proximity.shouldSubscribe ? "NEARBY" : "OUT_OF_RANGE",
  };
}

export function authorizeStoredTrackPull(input: {
  subscriberUserId: string;
  ownerUserId: string;
  subscriber: SpatialParticipant | null;
  publisher: SpatialParticipant | null;
  subscriberAccessClass?: SpatialAccessClass;
  publisherAccessClass?: SpatialAccessClass;
  map?: OfficeMap;
  trackKind?: "audio" | "video";
  broadcastSpeakerUserIds?: ReadonlySet<string>;
}):
  | { ok: true; reason: MediaAuthorizationReason }
  | {
      ok: false;
      error: "TRACK_NOT_AUTHORIZED";
      reason: MediaAuthorizationReason;
    } {
  if (input.ownerUserId === input.subscriberUserId) {
    return {
      ok: false,
      error: "TRACK_NOT_AUTHORIZED",
      reason: "MISSING_PRESENCE",
    };
  }
  if (!input.subscriber || !input.publisher) {
    return {
      ok: false,
      error: "TRACK_NOT_AUTHORIZED",
      reason: "MISSING_PRESENCE",
    };
  }
  const mediaOptions: MediaAuthorizationOptions = {
    publisherUserId: input.ownerUserId,
  };
  if (input.trackKind) mediaOptions.trackKind = input.trackKind;
  if (input.broadcastSpeakerUserIds) {
    mediaOptions.broadcastSpeakerUserIds = input.broadcastSpeakerUserIds;
  }
  const decision = authorizeMediaSubscription(
    input.subscriber,
    input.publisher,
    DEFAULT_PROXIMITY_MEDIA_CONFIG,
    input.map ?? OFFICE_MAP,
    input.subscriberAccessClass && input.publisherAccessClass
      ? {
          subscriberAccessClass: input.subscriberAccessClass,
          publisherAccessClass: input.publisherAccessClass,
        }
      : undefined,
    mediaOptions,
  );
  if (!decision.allowed) {
    return {
      ok: false,
      error: "TRACK_NOT_AUTHORIZED",
      reason: decision.reason,
    };
  }
  return { ok: true, reason: decision.reason };
}

export function remoteMediaShouldRender(input: {
  subscribed: boolean;
  kind: "audio" | "video";
}): boolean {
  return input.subscribed;
}
