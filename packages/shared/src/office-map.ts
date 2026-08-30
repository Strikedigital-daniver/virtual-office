import { TILE_SIZE } from "./protocol";

export type TileKind = "." | "#" | "D";

export interface MapZone {
  zoneId: string;
  zoneType: "desks" | "meeting" | "focus" | "rest";
  privacy: "public" | "room";
  x: number;
  y: number;
  width: number;
  height: number;
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

const WIDTH = 40;
const HEIGHT = 24;

function buildRows(): string[] {
  const grid: TileKind[][] = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => "." as TileKind),
  );

  const set = (x: number, y: number, kind: TileKind) => {
    grid[y]![x] = kind;
  };
  const wallRect = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    kind: TileKind = "#",
  ) => {
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) set(x, y, kind);
    }
  };

  // Outer walls.
  wallRect(0, 0, WIDTH - 1, 0);
  wallRect(0, HEIGHT - 1, WIDTH - 1, HEIGHT - 1);
  wallRect(0, 0, 0, HEIGHT - 1);
  wallRect(WIDTH - 1, 0, WIDTH - 1, HEIGHT - 1);

  // Meeting room (top-right): left wall with a two-tile door, bottom wall.
  wallRect(27, 1, 27, 8);
  set(27, 4, ".");
  set(27, 5, ".");
  wallRect(27, 8, 39, 8);

  // Focus room (bottom-left): top wall, right wall with a two-tile door.
  wallRect(1, 16, 8, 16);
  wallRect(8, 16, 8, 22);
  set(8, 19, ".");
  set(8, 20, ".");

  // Desk blocks (blocked tiles rendered as furniture).
  wallRect(5, 5, 8, 6, "D");
  wallRect(12, 5, 15, 6, "D");
  wallRect(5, 10, 8, 11, "D");
  wallRect(12, 10, 15, 11, "D");

  return grid.map((row) => row.join(""));
}

export const OFFICE_MAP: OfficeMap = {
  widthTiles: WIDTH,
  heightTiles: HEIGHT,
  rows: buildRows(),
  zones: [
    {
      zoneId: "zone-meeting",
      zoneType: "meeting",
      privacy: "room",
      x: 28,
      y: 1,
      width: 11,
      height: 7,
    },
    {
      zoneId: "zone-focus",
      zoneType: "focus",
      privacy: "room",
      x: 1,
      y: 17,
      width: 7,
      height: 6,
    },
    {
      zoneId: "zone-desks",
      zoneType: "desks",
      privacy: "public",
      x: 1,
      y: 4,
      width: 20,
      height: 9,
    },
    {
      zoneId: "zone-rest",
      zoneType: "rest",
      privacy: "public",
      x: 30,
      y: 17,
      width: 9,
      height: 6,
    },
  ],
  spawnPoints: [
    { x: 20, y: 20 },
    { x: 21, y: 20 },
    { x: 19, y: 20 },
    { x: 20, y: 21 },
    { x: 22, y: 20 },
    { x: 18, y: 20 },
    { x: 21, y: 21 },
  ],
};

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
  for (const zone of map.zones) {
    if (
      tileX >= zone.x &&
      tileX < zone.x + zone.width &&
      tileY >= zone.y &&
      tileY < zone.y + zone.height
    ) {
      return zone.zoneId;
    }
  }
  return null;
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
