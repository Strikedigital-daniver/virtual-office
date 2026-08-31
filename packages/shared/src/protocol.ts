import { z } from "zod";

export const TILE_SIZE = 32;
export const PLAYER_SPEED_PX_PER_S = 160;
export const MAX_SPEED_PX_PER_S = 220;
export const MOVE_SEND_HZ = 8;
export const INTERPOLATION_DELAY_MS = 120;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const REALTIME_TICKET_TTL_MS = 120_000;

export const PublishedTrackSchema = z.object({
  ownerUserId: z.string().uuid(),
  sessionId: z.string().min(1).max(128),
  trackName: z.string().min(1).max(160),
  mid: z.string().min(1).max(32),
  kind: z.enum(["audio", "video"]),
});
export type PublishedTrack = z.infer<typeof PublishedTrackSchema>;

export const DirectionSchema = z.enum(["up", "down", "left", "right"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const PlayerStateSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(40),
  x: z.number().finite(),
  y: z.number().finite(),
  direction: DirectionSchema,
  moving: z.boolean(),
  zoneId: z.string().nullable(),
  lastSeq: z.number().int().nonnegative(),
});
export type PlayerState = z.infer<typeof PlayerStateSchema>;

export const ClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("player.move"),
    seq: z.number().int().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
    direction: DirectionSchema,
    moving: z.boolean(),
    clientTime: z.number().finite(),
  }),
  z.object({
    type: z.literal("ping"),
    clientTime: z.number().finite(),
  }),
]);
export type ClientEvent = z.infer<typeof ClientEventSchema>;

export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("office.snapshot"),
    selfUserId: z.string().uuid(),
    players: z.array(PlayerStateSchema),
    publishedTracks: z.array(PublishedTrackSchema).default([]),
    serverTime: z.number(),
  }),
  z.object({
    type: z.literal("media.track.available"),
    track: PublishedTrackSchema,
  }),
  z.object({
    type: z.literal("media.track.revoked"),
    ownerUserId: z.string().uuid(),
    sessionId: z.string(),
    trackName: z.string(),
  }),
  z.object({ type: z.literal("player.joined"), player: PlayerStateSchema }),
  z.object({
    type: z.literal("player.updated"),
    player: PlayerStateSchema,
    serverTime: z.number(),
  }),
  z.object({ type: z.literal("player.left"), userId: z.string().uuid() }),
  z.object({
    type: z.literal("player.corrected"),
    x: z.number(),
    y: z.number(),
    seq: z.number().int().nonnegative(),
    reason: z.enum(["speed", "collision", "bounds"]),
  }),
  z.object({
    type: z.literal("pong"),
    clientTime: z.number(),
    serverTime: z.number(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;

export const TicketRequestSchema = z.object({
  officeSlug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
});
export type TicketRequest = z.infer<typeof TicketRequestSchema>;
