import { z } from "zod";

export const RoomIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-zA-Z0-9_-]+$/u);

export const DisplayNameSchema = z.string().trim().min(1).max(40);

export const TicketRequestSchema = z.object({
  roomId: RoomIdSchema,
  displayName: DisplayNameSchema,
});

export type TicketRequest = z.infer<typeof TicketRequestSchema>;

export const PlayerStateSchema = z.object({
  clientId: z.string().uuid(),
  displayName: DisplayNameSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  lastSeq: z.number().int().nonnegative(),
});

export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const PublishedAudioRefSchema = z.object({
  ownerClientId: z.string().uuid(),
  sessionId: z.string().min(1).max(128),
  trackName: z.string().min(1).max(160),
  mid: z.string().min(1).max(32),
  kind: z.literal("audio"),
});

export type PublishedAudioRef = z.infer<typeof PublishedAudioRefSchema>;

export const ClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("player.move"),
    seq: z.number().int().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
    clientTime: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("ping"),
    clientTime: z.number().int().nonnegative(),
  }),
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("office.snapshot"),
    selfClientId: z.string().uuid(),
    players: z.array(PlayerStateSchema),
    publishedAudio: z.array(PublishedAudioRefSchema),
    serverTime: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("player.joined"), player: PlayerStateSchema }),
  z.object({ type: z.literal("player.updated"), player: PlayerStateSchema }),
  z.object({ type: z.literal("player.left"), clientId: z.string().uuid() }),
  z.object({
    type: z.literal("media.track.available"),
    track: PublishedAudioRefSchema,
  }),
  z.object({
    type: z.literal("media.track.closed"),
    ownerClientId: z.string().uuid(),
    sessionId: z.string(),
    trackName: z.string(),
  }),
  z.object({
    type: z.literal("pong"),
    clientTime: z.number().int().nonnegative(),
    serverTime: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEventSchema>;

