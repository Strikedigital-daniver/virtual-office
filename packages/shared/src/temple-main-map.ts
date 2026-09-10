import type { TileKind } from "./office-map";
import { buildLegacyOfficeRows } from "./legacy-office-layout";
import type {
  DeskDefinition,
  PortalDefinition,
  RoomDefinition,
} from "./room-definition";
import { TEMPLE_MAIN_ROOM_ID } from "./room-definition";
import { TEMPLE_WORLD_ID } from "./spatial-worlds";

export const OFFICE_ZONE_ID = "zone-office";
export const TEMPLE_MAIN_MAP_VERSION = 3;

/** Office footprint origin inside temple-main (top-left tile of embedded layout). */
export const OFFICE_LAYOUT_ORIGIN = { x: 44, y: 6 } as const;

const WIDTH = 88;
const HEIGHT = 56;

function emptyGrid(): TileKind[][] {
  return Array.from({ length: HEIGHT }, () =>
    Array.from({ length: WIDTH }, () => "." as TileKind),
  );
}

function setTile(
  grid: TileKind[][],
  x: number,
  y: number,
  kind: TileKind,
): void {
  if (y < 0 || y >= HEIGHT || x < 0 || x >= WIDTH) return;
  grid[y]![x] = kind;
}

function wallRect(
  grid: TileKind[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: TileKind = "#",
): void {
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) setTile(grid, x, y, kind);
  }
}

function stampLegacyOffice(grid: TileKind[][]): void {
  const legacy = buildLegacyOfficeRows();
  const { x: ox, y: oy } = OFFICE_LAYOUT_ORIGIN;
  for (let y = 0; y < legacy.length; y += 1) {
    const row = legacy[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const kind = row[x] as TileKind;
      if (kind !== ".") setTile(grid, ox + x, oy + y, kind);
    }
  }
}

function translateSpawn(
  points: { x: number; y: number }[],
): { x: number; y: number }[] {
  return points.map((point) => ({
    x: point.x + OFFICE_LAYOUT_ORIGIN.x,
    y: point.y + OFFICE_LAYOUT_ORIGIN.y,
  }));
}

function buildDesks(): DeskDefinition[] {
  const { x: ox, y: oy } = OFFICE_LAYOUT_ORIGIN;
  const roomId = TEMPLE_MAIN_ROOM_ID;
  const deskSpecs: Array<{
    deskId: string;
    tileX: number;
    tileY: number;
    interactionTileX: number;
    interactionTileY: number;
    orientation: DeskDefinition["orientation"];
    label: string;
  }> = [
    {
      deskId: "desk-1",
      tileX: ox + 6,
      tileY: oy + 6,
      interactionTileX: ox + 6,
      interactionTileY: oy + 7,
      orientation: "up",
      label: "Desk 1",
    },
    {
      deskId: "desk-2",
      tileX: ox + 13,
      tileY: oy + 6,
      interactionTileX: ox + 13,
      interactionTileY: oy + 7,
      orientation: "up",
      label: "Desk 2",
    },
    {
      deskId: "desk-3",
      tileX: ox + 6,
      tileY: oy + 11,
      interactionTileX: ox + 6,
      interactionTileY: oy + 12,
      orientation: "up",
      label: "Desk 3",
    },
    {
      deskId: "desk-4",
      tileX: ox + 13,
      tileY: oy + 11,
      interactionTileX: ox + 13,
      interactionTileY: oy + 12,
      orientation: "up",
      label: "Desk 4",
    },
    {
      deskId: "desk-5",
      tileX: ox + 20,
      tileY: oy + 8,
      interactionTileX: ox + 20,
      interactionTileY: oy + 9,
      orientation: "up",
      label: "Desk 5",
    },
  ];

  return deskSpecs.map((spec) => ({
    deskId: spec.deskId,
    roomId,
    tileX: spec.tileX,
    tileY: spec.tileY,
    interactionTileX: spec.interactionTileX,
    interactionTileY: spec.interactionTileY,
    orientation: spec.orientation,
    label: spec.label,
    privateAreaId: `${spec.deskId}-area`,
    objectRefs: [`workstation-${spec.deskId}`],
  }));
}

function buildTempleRows(): string[] {
  const grid = emptyGrid();
  wallRect(grid, 0, 0, WIDTH - 1, 0);
  wallRect(grid, 0, HEIGHT - 1, WIDTH - 1, HEIGHT - 1);
  wallRect(grid, 0, 0, 0, HEIGHT - 1);
  wallRect(grid, WIDTH - 1, 0, WIDTH - 1, HEIGHT - 1);

  stampLegacyOffice(grid);

  const { x: ox, y: oy } = OFFICE_LAYOUT_ORIGIN;
  setTile(grid, ox, oy + 10, ".");
  setTile(grid, ox, oy + 11, ".");

  // Light circulation markers in commons (walkable decorative islands).
  wallRect(grid, 18, 40, 21, 41, "D");
  wallRect(grid, 58, 42, 61, 43, "D");

  return grid.map((row) => row.join(""));
}

const LEGACY_OFFICE_SPAWNS = [
  { x: 20, y: 20 },
  { x: 21, y: 20 },
  { x: 19, y: 20 },
  { x: 20, y: 21 },
  { x: 22, y: 20 },
  { x: 18, y: 20 },
  { x: 21, y: 21 },
];

const COMMONS_SPAWNS = [
  { x: 24, y: 48 },
  { x: 28, y: 48 },
  { x: 32, y: 48 },
  { x: 36, y: 48 },
  { x: 40, y: 48 },
  { x: 44, y: 48 },
  { x: 48, y: 48 },
];

const { x: ox, y: oy } = OFFICE_LAYOUT_ORIGIN;

export const TEMPLE_MAIN_MAP: RoomDefinition = {
  roomId: TEMPLE_MAIN_ROOM_ID,
  worldId: TEMPLE_WORLD_ID,
  slug: "temple-main",
  version: TEMPLE_MAIN_MAP_VERSION,
  widthTiles: WIDTH,
  heightTiles: HEIGHT,
  rows: buildTempleRows(),
  zones: [
    {
      zoneId: "zone-meeting",
      zoneType: "meeting",
      privacy: "room",
      x: ox + 28,
      y: oy + 1,
      width: 11,
      height: 7,
    },
    {
      zoneId: "zone-focus",
      zoneType: "focus",
      privacy: "room",
      x: ox + 1,
      y: oy + 17,
      width: 7,
      height: 6,
    },
    {
      zoneId: "zone-desks",
      zoneType: "desks",
      privacy: "public",
      x: ox + 1,
      y: oy + 4,
      width: 20,
      height: 9,
    },
    {
      zoneId: "zone-rest",
      zoneType: "rest",
      privacy: "public",
      x: ox + 30,
      y: oy + 17,
      width: 9,
      height: 6,
    },
    {
      zoneId: OFFICE_ZONE_ID,
      zoneType: "office",
      privacy: "public",
      x: ox,
      y: oy,
      width: 40,
      height: 24,
    },
    {
      zoneId: "zone-commons",
      zoneType: "commons",
      privacy: "public",
      x: 8,
      y: 32,
      width: 72,
      height: 20,
    },
    {
      zoneId: "zone-cowork",
      zoneType: "cowork",
      privacy: "public",
      x: 4,
      y: 12,
      width: 34,
      height: 18,
    },
    {
      zoneId: "zone-campfire-plaza",
      zoneType: "plaza",
      privacy: "public",
      x: 10,
      y: 34,
      width: 14,
      height: 12,
      editor: {
        movable: true,
        resizable: true,
        label: "Plaza fogata",
      },
    },
    {
      zoneId: "zone-campfire",
      zoneType: "broadcast",
      privacy: "public",
      x: 16,
      y: 39,
      width: 2,
      height: 2,
      broadcastConfig: {
        scope: "room",
        maxSpeakers: 1,
        audio: true,
        video: false,
      },
      editor: {
        movable: true,
        resizable: true,
        label: "Fogata",
      },
    },
    {
      zoneId: "zone-future-flow",
      zoneType: "future-flow",
      privacy: "public",
      x: 72,
      y: 32,
      width: 12,
      height: 14,
    },
  ],
  spawnPoints: COMMONS_SPAWNS,
  spawnPointsByAccess: {
    CLUB_MEMBER: COMMONS_SPAWNS,
    RECUERDA_STAFF: COMMONS_SPAWNS,
    OFFICE_COLLABORATOR: translateSpawn(LEGACY_OFFICE_SPAWNS),
  },
  desks: buildDesks(),
  portals: [
    {
      portalId: "portal-audionautica-future",
      sourceRoomId: TEMPLE_MAIN_ROOM_ID,
      sourceX: 80,
      sourceY: 46,
      sourceWidth: 2,
      sourceHeight: 2,
      targetRoomId: "audionautica",
      targetSpawnId: "audionautica-main",
      requiredCapability: "ENTER_AUDIONAUTICA",
      visualLabel: "Audionáutica",
    },
  ] satisfies PortalDefinition[],
};

/** Canonical runtime map for Temple main room (Phaser + Durable Object). */
export const OFFICE_MAP = TEMPLE_MAIN_MAP;
