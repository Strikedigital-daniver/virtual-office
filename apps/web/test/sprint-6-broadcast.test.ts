import { describe, expect, it } from "vitest";

import { ProximityMediaController } from "@/lib/proximity/proximity-media-controller";

describe("ProximityMediaController broadcast", () => {
  it("O: broadcast audio does not create duplicate subscription state", () => {
    const controller = new ProximityMediaController();
    const broadcasters = new Set(["remote-b"]);
    const first = controller.evaluate(
      { x: 0, y: 0, zoneId: "zone-cowork" },
      new Map([["remote-b", { x: 5_000, y: 0, zoneId: "zone-campfire" }]]),
      0,
      "CLUB_MEMBER",
      broadcasters,
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.desiredAudioSubscription).toBe(true);
    expect(first[0]?.desiredVideoSubscription).toBe(false);
    expect(first[0]?.audioFactor).toBe(1);

    const second = controller.evaluate(
      { x: 100, y: 100, zoneId: "zone-campfire" },
      new Map([["remote-b", { x: 120, y: 110, zoneId: "zone-campfire" }]]),
      50,
      "CLUB_MEMBER",
      broadcasters,
    );
    expect(second[0]?.desiredAudioSubscription).toBe(true);
    expect(second[0]?.audioAuthorizationReason).toBe("ROOM_BROADCAST");
  });
});
