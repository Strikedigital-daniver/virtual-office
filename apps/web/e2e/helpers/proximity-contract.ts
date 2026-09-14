import { DEFAULT_PROXIMITY_MEDIA_CONFIG } from "@virtual-office/shared";

/** Mirrors shared proximity contract used by production and unit tests. */
export const PROXIMITY = {
  audioFullRadius: DEFAULT_PROXIMITY_MEDIA_CONFIG.audio.fullRadius,
  audioOuterRadius: DEFAULT_PROXIMITY_MEDIA_CONFIG.audio.outerRadius,
  videoFullRadius: DEFAULT_PROXIMITY_MEDIA_CONFIG.video.fullRadius,
  videoOuterRadius: DEFAULT_PROXIMITY_MEDIA_CONFIG.video.outerRadius,
  unsubscribeRadius:
    DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription.unsubscribeRadius,
} as const;

/** Stay comfortably inside hard audio cutoff (12 tiles × 32px). */
export const NEAR_MAX_DISTANCE = PROXIMITY.audioFullRadius - 32;

/** Just outside hard audio cutoff — expect silence with subscription still on. */
export const FAR_MIN_DISTANCE = PROXIMITY.audioOuterRadius + 16;

/** Outside unsubscribe hysteresis — expect delayed unsubscribe when idle. */
export const UNSUBSCRIBE_MIN_DISTANCE = PROXIMITY.unsubscribeRadius + 16;

/** Video fade band: between full and outer radii. */
export const VIDEO_FADE_MIN = PROXIMITY.videoFullRadius + 8;
export const VIDEO_FADE_MAX = PROXIMITY.videoOuterRadius - 8;
