import { z } from "zod";

import type { OfficeMap, SpawnPoint } from "./office-map";

export const DeskDefinitionSchema = z.object({
  deskId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  tileX: z.number().int().nonnegative(),
  tileY: z.number().int().nonnegative(),
  interactionTileX: z.number().int().nonnegative().optional(),
  interactionTileY: z.number().int().nonnegative().optional(),
  label: z.string().max(40).optional(),
  privateAreaId: z.string().max(64).optional(),
  orientation: z.enum(["up", "down", "left", "right"]).optional(),
  objectRefs: z.array(z.string().max(64)).optional(),
});
export type DeskDefinition = z.infer<typeof DeskDefinitionSchema>;

export const PortalDefinitionSchema = z.object({
  portalId: z.string().min(1).max(64),
  sourceRoomId: z.string().min(1).max(64),
  sourceX: z.number().int().nonnegative(),
  sourceY: z.number().int().nonnegative(),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  targetRoomId: z.string().min(1).max(64),
  targetSpawnId: z.string().min(1).max(64),
  requiredCapability: z.string().max(64).optional(),
  visualLabel: z.string().max(40).optional(),
});
export type PortalDefinition = z.infer<typeof PortalDefinitionSchema>;

export const RoomDefinitionSchema = z.object({
  roomId: z.string().min(1).max(64),
  worldId: z.string().uuid(),
  slug: z.string().min(1).max(64),
  version: z.number().int().positive(),
  widthTiles: z.number().int().positive(),
  heightTiles: z.number().int().positive(),
  rows: z.array(z.string().min(1)),
  zones: z.array(
    z.object({
      zoneId: z.string(),
      zoneType: z.string(),
      privacy: z.enum(["public", "room"]),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      broadcastConfig: z
        .object({
          scope: z.literal("room"),
          maxSpeakers: z.number().int().positive(),
          audio: z.boolean(),
          video: z.boolean(),
        })
        .optional(),
      editor: z
        .object({
          movable: z.boolean(),
          resizable: z.boolean(),
          label: z.string().max(40),
        })
        .optional(),
    }),
  ),
  spawnPoints: z.array(
    z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
    }),
  ),
  spawnPointsByAccess: z
    .record(
      z.string(),
      z.array(
        z.object({
          x: z.number().int().nonnegative(),
          y: z.number().int().nonnegative(),
        }),
      ),
    )
    .optional(),
  desks: z.array(DeskDefinitionSchema),
  portals: z.array(PortalDefinitionSchema),
});
export type RoomDefinition = z.infer<typeof RoomDefinitionSchema> & OfficeMap;

export function parseDeskDefinitions(value: unknown): DeskDefinition[] {
  return z.array(DeskDefinitionSchema).parse(value);
}

export function parsePortalDefinitions(value: unknown): PortalDefinition[] {
  return z.array(PortalDefinitionSchema).parse(value);
}

export function parseRoomDefinition(value: unknown): RoomDefinition {
  return RoomDefinitionSchema.parse(value) as RoomDefinition;
}

export const TEMPLE_MAIN_ROOM_ID = "temple-main";

export function roomChecksum(
  room: Pick<RoomDefinition, "version" | "rows">,
): string {
  const payload = `${room.version}:${room.rows.join("|")}`;
  let hash = 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (hash * 31 + payload.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function spawnPointsForAccess(
  room: RoomDefinition,
  accessKey: string,
): SpawnPoint[] {
  const specific = room.spawnPointsByAccess?.[accessKey];
  if (specific?.length) return specific;
  return room.spawnPoints;
}
