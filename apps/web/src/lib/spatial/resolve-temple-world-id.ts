import type { AppEnvironment } from "@virtual-office/shared";
import { TEMPLE_WORLD_ID } from "@virtual-office/shared";

export type TempleWorldResolution =
  | { ok: true; templeWorldId: string }
  | { ok: false; reason: "query_error" | "missing_row" };

export function resolveTempleWorldId(
  world: { id: string } | null,
  worldError: { message: string } | null,
  appEnvironment: AppEnvironment | null,
): TempleWorldResolution {
  if (worldError) {
    return { ok: false, reason: "query_error" };
  }
  if (world?.id) {
    return { ok: true, templeWorldId: world.id };
  }
  if (appEnvironment === "development") {
    return { ok: true, templeWorldId: TEMPLE_WORLD_ID };
  }
  return { ok: false, reason: "missing_row" };
}
