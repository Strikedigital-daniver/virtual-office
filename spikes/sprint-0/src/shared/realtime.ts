import { z } from "zod";

export const SessionDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1),
});

const SessionIdSchema = z.string().min(1).max(128);
const TrackNameSchema = z.string().min(1).max(160);
const MidSchema = z.string().min(1).max(32);

export const PublishTracksRequestSchema = z.object({
  sessionId: SessionIdSchema,
  sessionDescription: SessionDescriptionSchema,
  tracks: z
    .array(
      z.object({
        location: z.literal("local"),
        mid: MidSchema,
        trackName: TrackNameSchema,
        kind: z.literal("audio"),
      }),
    )
    .min(1)
    .max(1),
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
    .max(7),
});

export const RenegotiateRequestSchema = z.object({
  sessionId: SessionIdSchema,
  sessionDescription: SessionDescriptionSchema,
});

export const CloseTracksRequestSchema = z.object({
  sessionId: SessionIdSchema,
  tracks: z.array(z.object({ mid: MidSchema })).min(1).max(7),
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

