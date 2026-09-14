import type { Page } from "@playwright/test";

import { focusCanvas, readPeerDistancePx } from "./session";
import { E2E_TIMING } from "./timing";

const KEY_MAP: Record<string, string> = {
  up: "w",
  down: "s",
  left: "a",
  right: "d",
};

export async function holdKey(
  page: Page,
  key: string,
  durationMs: number,
): Promise<void> {
  await focusCanvas(page);
  await page.keyboard.down(key);
  await page.waitForTimeout(durationMs);
  await page.keyboard.up(key);
}

export async function nudge(
  page: Page,
  direction: keyof typeof KEY_MAP,
  durationMs = 250,
): Promise<void> {
  await holdKey(page, KEY_MAP[direction], durationMs);
  await page.waitForTimeout(100);
}

export async function moveUntilDistance(
  page: Page,
  target: { min?: number; max?: number },
  options: {
    timeoutMs?: number;
    remoteUserId: string;
    requireReached?: boolean;
  },
): Promise<{ distance: number; reached: boolean; zone: string | null }> {
  const timeoutMs = options.timeoutMs ?? E2E_TIMING.moveTimeoutMs;
  const requireReached = options.requireReached ?? true;
  const started = Date.now();
  let lastDistance = Number.POSITIVE_INFINITY;
  let lastZone: string | null = null;

  while (Date.now() - started < timeoutMs) {
    const reading = await readPeerDistancePx(page, options.remoteUserId);
    if (!reading) {
      await nudge(page, "right", 300);
      continue;
    }
    lastDistance = reading.distance;
    lastZone = reading.zone;
    const minOk = target.min === undefined || reading.distance >= target.min;
    const maxOk = target.max === undefined || reading.distance <= target.max;
    if (minOk && maxOk) {
      return {
        distance: reading.distance,
        reached: true,
        zone: reading.zone,
      };
    }

    if (target.max !== undefined && reading.distance > target.max) {
      await nudge(page, "left", 420);
      await nudge(page, "up", 320);
    } else if (target.min !== undefined && reading.distance < target.min) {
      await nudge(page, "right", 420);
      await nudge(page, "down", 320);
    } else {
      await nudge(page, "right", 320);
    }
  }

  if (requireReached) {
    throw new Error(
      `No se alcanzó distancia objetivo para ${options.remoteUserId.slice(0, 8)} (última=${Number.isFinite(lastDistance) ? Math.round(lastDistance) : "—"}px, zona=${lastZone ?? "—"})`,
    );
  }
  return { distance: lastDistance, reached: false, zone: lastZone };
}

export async function settle(ms = 1_500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
