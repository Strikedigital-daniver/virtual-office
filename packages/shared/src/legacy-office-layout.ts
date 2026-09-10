import type { TileKind } from "./office-map";

const LEGACY_WIDTH = 40;
const LEGACY_HEIGHT = 24;

/** Former Sprint-4 office layout used as the embedded Office footprint. */
export function buildLegacyOfficeRows(): string[] {
  const grid: TileKind[][] = Array.from({ length: LEGACY_HEIGHT }, () =>
    Array.from({ length: LEGACY_WIDTH }, () => "." as TileKind),
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

  wallRect(0, 0, LEGACY_WIDTH - 1, 0);
  wallRect(0, LEGACY_HEIGHT - 1, LEGACY_WIDTH - 1, LEGACY_HEIGHT - 1);
  wallRect(0, 0, 0, LEGACY_HEIGHT - 1);
  wallRect(LEGACY_WIDTH - 1, 0, LEGACY_WIDTH - 1, LEGACY_HEIGHT - 1);

  wallRect(27, 1, 27, 8);
  set(27, 4, ".");
  set(27, 5, ".");
  wallRect(27, 8, 39, 8);

  wallRect(1, 16, 8, 16);
  wallRect(8, 16, 8, 22);
  set(8, 19, ".");
  set(8, 20, ".");

  wallRect(5, 5, 8, 6, "D");
  wallRect(12, 5, 15, 6, "D");
  wallRect(5, 10, 8, 11, "D");
  wallRect(12, 10, 15, 11, "D");

  return grid.map((row) => row.join(""));
}
