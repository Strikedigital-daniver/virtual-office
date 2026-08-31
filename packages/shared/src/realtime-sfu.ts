import { z } from "zod";

export const SessionDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1),
});
export type SessionDescription = z.infer<typeof SessionDescriptionSchema>;

const SessionIdSchema = z.string().min(1).max(128);
const TrackNameSchema = z.string().min(1).max(160);
const MidSchema = z.string().min(1).max(32);

export const MediaKindSchema = z.enum(["audio", "video"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const PublishTracksRequestSchema = z.object({
  sessionId: SessionIdSchema,
  sessionDescription: SessionDescriptionSchema,
  tracks: z
    .array(
      z.object({
        location: z.literal("local"),
        mid: MidSchema,
        trackName: TrackNameSchema,
        kind: MediaKindSchema,
      }),
    )
    .min(1)
    .max(2),
});

export const SubscribeTracksRequestSchema = z.object({
  sessionId: SessionIdSchema,
  tracks: z
    .array(
      z.object({
        location: z.literal("remote"),
        sessionId: SessionIdSchema,
        trackName: TrackNameSchema,
      }),
    )
    .min(1)
    .max(14),
});

export const RenegotiateRequestSchema = z.object({
  sessionId: SessionIdSchema,
  sessionDescription: SessionDescriptionSchema,
});

export const CloseTracksRequestSchema = z.object({
  sessionId: SessionIdSchema,
  tracks: z
    .array(z.object({ mid: MidSchema }))
    .min(1)
    .max(14),
  sessionDescription: SessionDescriptionSchema.optional(),
  force: z.boolean().optional(),
});

export const RealtimeResponseSchema = z
  .object({
    errorCode: z.string().optional(),
    errorDescription: z.string().optional(),
    sessionId: z.string().optional(),
    requiresImmediateRenegotiation: z.boolean().optional(),
    sessionDescription: SessionDescriptionSchema.optional(),
    tracks: z
      .array(
        z.object({
          sessionId: z.string().optional(),
          trackName: z.string().optional(),
          mid: z.string().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
export type RealtimeResponse = z.infer<typeof RealtimeResponseSchema>;

// Declared without DOM types so the Worker can import this module too; the web
// app applies them as MediaTrackConstraints.
export const audioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
} as const;

export const videoConstraints = {
  width: { ideal: 640, max: 640 },
  height: { ideal: 360, max: 360 },
  frameRate: { ideal: 15, max: 15 },
  facingMode: "user",
} as const;

export const VIDEO_MAX_BITRATE_BPS = 350_000;
export const AUDIO_MAX_BITRATE_BPS = 32_000;
export const MAX_PUBLIC_VIDEO_TILES = 4;
