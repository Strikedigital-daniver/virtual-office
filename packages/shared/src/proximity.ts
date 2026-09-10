import { TILE_SIZE } from "./protocol";

/** Temporary radii for the current small test map — tune after redesign. */
export const PROXIMITY_VALUES_REQUIRE_MAP_TUNING = true;

export const CURRENT_MAP_SCALE = {
  tileSizePx: TILE_SIZE,
  widthTiles: 40,
  heightTiles: 24,
} as const;

export interface ProximityBandConfig {
  fullRadius: number;
  outerRadius: number;
}

export interface ProximitySubscriptionConfig {
  subscribeRadius: number;
  unsubscribeRadius: number;
  unsubscribeDelayMs: number;
  minSubscribedMs: number;
}

export interface ProximityMediaConfig {
  audio: ProximityBandConfig;
  video: ProximityBandConfig;
  subscription: ProximitySubscriptionConfig;
}

/**
 * Conversation range on the 32px temple map (40×24 tiles).
 *
 * Audio is a hard cutoff (fullRadius === outerRadius): on or off, no distance
 * fade. The previous 2.5-tile radius was smaller than a desk cluster, so QA
 * pairs got one-way audio (hysteresis on one client, OUT_OF_RANGE on the
 * other) and choppy cutouts while walking. 12 tiles is still local to a
 * wing of the office, not building-wide.
 */
export const DEFAULT_PROXIMITY_MEDIA_CONFIG: ProximityMediaConfig = {
  audio: {
    fullRadius: TILE_SIZE * 12,
    outerRadius: TILE_SIZE * 12,
  },
  video: {
    fullRadius: TILE_SIZE * 4,
    outerRadius: TILE_SIZE * 8,
  },
  subscription: {
    subscribeRadius: TILE_SIZE * 12,
    unsubscribeRadius: TILE_SIZE * 14,
    unsubscribeDelayMs: 2_000,
    minSubscribedMs: 1_500,
  },
};

export type ProximityZone = "FULL" | "FADE" | "OUT_OF_RANGE";

export function distanceBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function smoothstep(
  edge0: number,
  edge1: number,
  value: number,
): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Returns 1 inside fullRadius, 0 at/after outerRadius, smooth fade between.
 */
export function getProximityFactor(
  distance: number,
  band: ProximityBandConfig,
): number {
  if (distance <= band.fullRadius) return 1;
  if (distance >= band.outerRadius) return 0;
  return 1 - smoothstep(band.fullRadius, band.outerRadius, distance);
}

export function proximityZone(
  distance: number,
  band: ProximityBandConfig,
): ProximityZone {
  if (distance <= band.fullRadius) return "FULL";
  if (distance >= band.outerRadius) return "OUT_OF_RANGE";
  return "FADE";
}

export interface ProximityFactors {
  distance: number;
  audioFactor: number;
  videoFactor: number;
  zone: ProximityZone;
}

export function computeProximityFactors(
  distance: number,
  config: ProximityMediaConfig = DEFAULT_PROXIMITY_MEDIA_CONFIG,
): ProximityFactors {
  const audioFactor = getProximityFactor(distance, config.audio);
  const videoFactor = getProximityFactor(distance, config.video);
  const zone =
    audioFactor >= 1 && videoFactor >= 1
      ? "FULL"
      : audioFactor <= 0 && videoFactor <= 0
        ? "OUT_OF_RANGE"
        : "FADE";
  return { distance, audioFactor, videoFactor, zone };
}

export interface ProximitySubscriptionInput {
  distance: number;
  nowMs: number;
  wasSubscribed: boolean;
  subscribedSinceMs: number | null;
  pendingUnsubscribeAtMs: number | null;
}

export interface ProximitySubscriptionDecision {
  shouldSubscribe: boolean;
  pendingUnsubscribeAtMs: number | null;
  subscribedSinceMs: number | null;
}

/**
 * Hysteresis: subscribe inside subscribeRadius, unsubscribe only after
 * unsubscribeRadius (larger) plus optional delay.
 *
 * Future override hook:
 *   shouldSubscribe(remote) = isNearby(remote) || isBroadcastSpeaker(remote) || ...
 * V1 uses isNearby only.
 */
export function decideProximitySubscription(
  input: ProximitySubscriptionInput,
  config: ProximitySubscriptionConfig = DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription,
): ProximitySubscriptionDecision {
  const {
    distance,
    nowMs,
    wasSubscribed,
    subscribedSinceMs,
    pendingUnsubscribeAtMs,
  } = input;

  if (!wasSubscribed) {
    if (distance <= config.subscribeRadius) {
      return {
        shouldSubscribe: true,
        pendingUnsubscribeAtMs: null,
        subscribedSinceMs: nowMs,
      };
    }
    return {
      shouldSubscribe: false,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs: null,
    };
  }

  if (distance <= config.subscribeRadius) {
    return {
      shouldSubscribe: true,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs: subscribedSinceMs ?? nowMs,
    };
  }

  if (distance < config.unsubscribeRadius) {
    return {
      shouldSubscribe: true,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs: subscribedSinceMs ?? nowMs,
    };
  }

  const minHeld =
    subscribedSinceMs !== null &&
    nowMs - subscribedSinceMs < config.minSubscribedMs;
  if (minHeld) {
    return {
      shouldSubscribe: true,
      pendingUnsubscribeAtMs: null,
      subscribedSinceMs,
    };
  }

  const pendingAt = pendingUnsubscribeAtMs ?? nowMs + config.unsubscribeDelayMs;
  if (nowMs < pendingAt) {
    return {
      shouldSubscribe: true,
      pendingUnsubscribeAtMs: pendingAt,
      subscribedSinceMs,
    };
  }

  return {
    shouldSubscribe: false,
    pendingUnsubscribeAtMs: null,
    subscribedSinceMs: null,
  };
}

export function effectiveAudioGain(input: {
  remoteMicPublished: boolean;
  subscribed: boolean;
  audioFactor: number;
}): number {
  if (!input.remoteMicPublished || !input.subscribed) return 0;
  return Math.min(1, Math.max(0, input.audioFactor));
}

export function effectiveWorldVideoOpacity(input: {
  remoteCameraPublished: boolean;
  subscribed: boolean;
  videoFactor: number;
}): number {
  if (!input.remoteCameraPublished || !input.subscribed) return 0;
  return Math.min(1, Math.max(0, input.videoFactor));
}
