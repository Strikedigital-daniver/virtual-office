import { describe, expect, it } from "vitest";

import {
  authorizeStoredTrackPull,
  OFFICE_MAP,
  TILE_SIZE,
} from "@virtual-office/shared";

function pixelInZone(zoneId: string): { x: number; y: number; zoneId: string } {
  const zone = OFFICE_MAP.zones.find((item) => item.zoneId === zoneId)!;
  const x = (zone.x + 1) * TILE_SIZE + TILE_SIZE / 2;
  const y = (zone.y + 1) * TILE_SIZE + TILE_SIZE / 2;
  return { x, y, zoneId };
}

describe("OfficeRoom spatial subscribe gate", () => {
  it("refuses an out-of-range pull even when the caller knows session and track names", () => {
    const result = authorizeStoredTrackPull({
      subscriberUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ownerUserId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      subscriber: { x: 80, y: 80, zoneId: "zone-desks" },
      publisher: { x: 1_800, y: 1_800, zoneId: "zone-rest" },
    });
    expect(result).toEqual({
      ok: false,
      error: "TRACK_NOT_AUTHORIZED",
      reason: "OUT_OF_RANGE",
    });
  });

  it("refuses a hallway listener pulling a meeting-room track", () => {
    const meeting = pixelInZone("zone-meeting");
    const hallway = OFFICE_MAP.zones.find(
      (zone) => zone.zoneId === "zone-office",
    )!;
    const result = authorizeStoredTrackPull({
      subscriberUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ownerUserId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      subscriber: {
        x: (hallway.x + 26) * TILE_SIZE + TILE_SIZE / 2,
        y: (hallway.y + 4) * TILE_SIZE + TILE_SIZE / 2,
        zoneId: null,
      },
      publisher: meeting,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.error).toBe("TRACK_NOT_AUTHORIZED");
    expect(result.reason).toBe("CLOSED_ROOM");
  });
});
