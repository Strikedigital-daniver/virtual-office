import { describe, expect, it } from "vitest";

import { ProximityMediaController } from "@/lib/proximity/proximity-media-controller";

describe("ProximityMediaController", () => {
  it("does not subscribe globally when participants are far apart", () => {
    const controller = new ProximityMediaController();
    const snapshots = controller.evaluate(
      { x: 0, y: 0, zoneId: null },
      new Map([["remote-b", { x: 2_000, y: 0, zoneId: null }]]),
      0,
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.desiredSubscription).toBe(false);
  });

  it("subscribes when participants are close", () => {
    const controller = new ProximityMediaController();
    const snapshots = controller.evaluate(
      { x: 100, y: 100, zoneId: null },
      new Map([["remote-b", { x: 120, y: 110, zoneId: null }]]),
      0,
    );
    expect(snapshots[0]?.desiredSubscription).toBe(true);
    expect(snapshots[0]?.audioFactor).toBeGreaterThan(0);
  });

  it("clears subscription state when a remote participant leaves", () => {
    const controller = new ProximityMediaController();
    const first = controller.evaluate(
      { x: 100, y: 100, zoneId: null },
      new Map([["remote-b", { x: 120, y: 110, zoneId: null }]]),
      0,
    );
    expect(first[0]?.desiredSubscription).toBe(true);

    const afterLeave = controller.evaluate(
      { x: 100, y: 100, zoneId: null },
      new Map(),
      50,
    );
    expect(afterLeave).toEqual([]);
  });
});
