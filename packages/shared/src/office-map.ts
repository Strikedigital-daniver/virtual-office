import { TILE_SIZE } from "./protocol";

export type TileKind = "." | "#" | "D";

export type MapZoneType =
  | "desks"
  | "meeting"
  | "focus"
  | "rest"
  | "office"
  | "commons"
  | "cowork"
  | "broadcast"
  | "plaza"
  | "future-flow";

export interface BroadcastZoneConfig {
  scope: "room";
  maxSpeakers: number;
  audio: boolean;
  video: boolean;
}

export interface MapZoneEditorMeta {
  movable: boolean;
  resizable: boolean;
  label: string;
}

export interface MapZone {
  zoneId: string;
  zoneType: MapZoneType;
  privacy: "public" | "room";
  x: number;
  y: number;
  width: number;
  height: number;
  broadcastConfig?: BroadcastZoneConfig;
  editor?: MapZoneEditorMeta;
}

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface OfficeMap {
  widthTiles: number;
  heightTiles: number;
  rows: string[];
  zones: MapZone[];
  spawnPoints: SpawnPoint[];
}

export function tileAt(map: OfficeMap, tileX: number, tileY: number): TileKind {
  if (
    tileX < 0 ||
    tileY < 0 ||
    tileX >= map.widthTiles ||
    tileY >= map.heightTiles
  ) {
    return "#";
  }
  return (map.rows[tileY]?.[tileX] ?? "#") as TileKind;
}

export function isBlockedAtPixel(
  map: OfficeMap,
  x: number,
  y: number,
): boolean {
  return (
    tileAt(map, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)) !== "."
  );
}

export function zoneAtPixel(
  map: OfficeMap,
  x: number,
  y: number,
): string | null {
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  let best: MapZone | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const zone of map.zones) {
    if (
      tileX >= zone.x &&
      tileX < zone.x + zone.width &&
      tileY >= zone.y &&
      tileY < zone.y + zone.height
    ) {
      const area = zone.width * zone.height;
      if (area < bestArea) {
        best = zone;
        bestArea = area;
      }
    }
  }
  return best?.zoneId ?? null;
}

export function zoneDefinition(
  map: OfficeMap,
  zoneId: string | null,
): MapZone | null {
  if (!zoneId) return null;
  return map.zones.find((zone) => zone.zoneId === zoneId) ?? null;
}

export function spawnFor(map: OfficeMap, index: number): SpawnPoint {
  const spawn = map.spawnPoints[index % map.spawnPoints.length]!;
  return spawn;
}

export function spawnPixel(spawn: SpawnPoint): { x: number; y: number } {
  return {
    x: spawn.x * TILE_SIZE + TILE_SIZE / 2,
    y: spawn.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function mapPixelSize(map: OfficeMap): {
  width: number;
  height: number;
} {
  return {
    width: map.widthTiles * TILE_SIZE,
    height: map.heightTiles * TILE_SIZE,
  };
}
