import { describe, expect, it } from "vitest";

import {
  ClientEventSchema,
  OFFICE_MAP,
  TILE_SIZE,
  isBlockedAtPixel,
  issueRealtimeTicket,
  mapPixelSize,
  spawnPixel,
  tileAt,
  verifyRealtimeTicket,
  zoneAtPixel,
} from "../src/index";

const SECRET = "test-signing-secret-at-least-thirty-two-characters";

describe("office map integrity", () => {
  it("keeps a closed border and consistent row widths", () => {
    expect(OFFICE_MAP.rows).toHaveLength(OFFICE_MAP.heightTiles);
    for (const row of OFFICE_MAP.rows) {
      expect(row).toHaveLength(OFFICE_MAP.widthTiles);
    }
    for (let x = 0; x < OFFICE_MAP.widthTiles; x += 1) {
      expect(tileAt(OFFICE_MAP, x, 0)).toBe("#");
      expect(tileAt(OFFICE_MAP, x, OFFICE_MAP.heightTiles - 1)).toBe("#");
    }
    for (let y = 0; y < OFFICE_MAP.heightTiles; y += 1) {
      expect(tileAt(OFFICE_MAP, 0, y)).toBe("#");
      expect(tileAt(OFFICE_MAP, OFFICE_MAP.widthTiles - 1, y)).toBe("#");
    }
  });

  it("places every spawn point on walkable floor", () => {
    expect(OFFICE_MAP.spawnPoints.length).toBeGreaterThanOrEqual(7);
    for (const spawn of OFFICE_MAP.spawnPoints) {
      const pixel = spawnPixel(spawn);
      expect(isBlockedAtPixel(OFFICE_MAP, pixel.x, pixel.y)).toBe(false);
    }
  });

  it("keeps zones inside the map and derives them from positions", () => {
    for (const zone of OFFICE_MAP.zones) {
      expect(zone.x).toBeGreaterThan(0);
      expect(zone.y).toBeGreaterThan(0);
      expect(zone.x + zone.width).toBeLessThan(OFFICE_MAP.widthTiles);
      expect(zone.y + zone.height).toBeLessThan(OFFICE_MAP.heightTiles);
    }
    const meeting = OFFICE_MAP.zones.find((z) => z.zoneId === "zone-meeting")!;
    const inside = {
      x: (meeting.x + 1) * TILE_SIZE,
      y: (meeting.y + 1) * TILE_SIZE,
    };
    expect(zoneAtPixel(OFFICE_MAP, inside.x, inside.y)).toBe("zone-meeting");
    const spawn = spawnPixel(OFFICE_MAP.spawnPoints[0]!);
    expect(zoneAtPixel(OFFICE_MAP, spawn.x, spawn.y)).toBeNull();
  });

  it("keeps the pixel size aligned to the tile grid", () => {
    const { width, height } = mapPixelSize(OFFICE_MAP);
    expect(width).toBe(OFFICE_MAP.widthTiles * TILE_SIZE);
    expect(height).toBe(OFFICE_MAP.heightTiles * TILE_SIZE);
  });
});

describe("realtime tickets", () => {
  const input = {
    userId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
    officeId: "0b54f2dc-6f19-4f6b-9b2b-7a3d0e6a1c11",
    displayName: "Daniver",
  };

  it("round-trips valid claims", async () => {
    const token = await issueRealtimeTicket(input, SECRET);
    const claims = await verifyRealtimeTicket(token, SECRET);
    expect(claims.userId).toBe(input.userId);
    expect(claims.officeId).toBe(input.officeId);
    expect(claims.displayName).toBe("Daniver");
  });

  it("rejects tampering, wrong secrets and expiry", async () => {
    const token = await issueRealtimeTicket(input, SECRET);
    await expect(
      verifyRealtimeTicket(token, SECRET.replaceAll("t", "x")),
    ).rejects.toThrow();
    await expect(verifyRealtimeTicket(`${token}x`, SECRET)).rejects.toThrow();
    const old = await issueRealtimeTicket(input, SECRET, Date.now() - 600_000);
    await expect(verifyRealtimeTicket(old, SECRET)).rejects.toThrow(
      "Ticket expired",
    );
  });
});

describe("client events", () => {
  it("accepts a well-formed move and rejects extra shapes", () => {
    expect(
      ClientEventSchema.safeParse({
        type: "player.move",
        seq: 3,
        x: 100,
        y: 200,
        direction: "left",
        moving: true,
        clientTime: Date.now(),
      }).success,
    ).toBe(true);
    expect(
      ClientEventSchema.safeParse({ type: "player.teleport", x: 1, y: 1 })
        .success,
    ).toBe(false);
  });
});
