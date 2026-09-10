import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  OFFICE_LAYOUT_ORIGIN,
  OFFICE_MAP,
  TILE_SIZE,
  authorizeMediaSubscription,
  authorizeStoredTrackPull,
  decideSpatialSubscription,
  remoteMediaShouldRender,
  zoneAtPixel,
} from "../src/index";

function pixelInZone(zoneId: string): { x: number; y: number; zoneId: string } {
  const zone = OFFICE_MAP.zones.find((item) => item.zoneId === zoneId)!;
  const x = (zone.x + 1) * TILE_SIZE + TILE_SIZE / 2;
  const y = (zone.y + 1) * TILE_SIZE + TILE_SIZE / 2;
  return { x, y, zoneId };
}

function hallwayNearMeeting(): { x: number; y: number; zoneId: string | null } {
  const { x: ox, y: oy } = OFFICE_LAYOUT_ORIGIN;
  const x = (ox + 26) * TILE_SIZE + TILE_SIZE / 2;
  const y = (oy + 4) * TILE_SIZE + TILE_SIZE / 2;
  return { x, y, zoneId: zoneAtPixel(OFFICE_MAP, x, y) };
}

describe("authorizeMediaSubscription", () => {
  it("allows nearby public participants", () => {
    const a = { x: 30 * TILE_SIZE, y: 48 * TILE_SIZE, zoneId: "zone-commons" };
    const b = { x: 31 * TILE_SIZE, y: 48 * TILE_SIZE, zoneId: "zone-commons" };
    expect(authorizeMediaSubscription(a, b).allowed).toBe(true);
    expect(authorizeMediaSubscription(a, b).reason).toBe("NEARBY");
  });

  it("rejects a far public pull even if the track name is known", () => {
    const a = { x: 12 * TILE_SIZE, y: 48 * TILE_SIZE, zoneId: "zone-commons" };
    const b = { x: 70 * TILE_SIZE, y: 48 * TILE_SIZE, zoneId: "zone-commons" };
    const decision = authorizeMediaSubscription(a, b);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("OUT_OF_RANGE");
  });

  it("keeps a stable meeting group regardless of internal distance", () => {
    const meeting = OFFICE_MAP.zones.find(
      (zone) => zone.zoneId === "zone-meeting",
    )!;
    const a = pixelInZone("zone-meeting");
    const b = {
      x: (meeting.x + meeting.width - 2) * TILE_SIZE,
      y: (meeting.y + meeting.height - 2) * TILE_SIZE,
      zoneId: "zone-meeting",
    };
    const decision = authorizeMediaSubscription(a, b);
    expect(decision.allowed).toBe(true);
    expect(decision.ignoreDistance).toBe(true);
    expect(decision.reason).toBe("SAME_MEETING");
  });

  it("blocks a listener outside a closed meeting even when distance is small", () => {
    const inside = pixelInZone("zone-meeting");
    const outside = hallwayNearMeeting();
    const decision = authorizeMediaSubscription(outside, inside);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CLOSED_ROOM");
  });

  it("allows nearby staff in the office hallway (container is not a sealed meeting)", () => {
    const hallway = hallwayNearMeeting();
    const neighbor = {
      x: hallway.x + TILE_SIZE,
      y: hallway.y,
      zoneId: zoneAtPixel(OFFICE_MAP, hallway.x + TILE_SIZE, hallway.y),
    };
    const decision = authorizeMediaSubscription(
      hallway,
      neighbor,
      undefined,
      OFFICE_MAP,
      {
        subscriberAccessClass: "RECUERDA_STAFF",
        publisherAccessClass: "RECUERDA_STAFF",
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("NEARBY");
  });

  it("ignores a stale closed zoneId when pixels are in Temple commons", () => {
    const a = {
      x: 30 * TILE_SIZE,
      y: 48 * TILE_SIZE,
      zoneId: "zone-meeting",
    };
    const b = {
      x: 31 * TILE_SIZE,
      y: 48 * TILE_SIZE,
      zoneId: "zone-focus",
    };
    const decision = authorizeMediaSubscription(a, b);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("NEARBY");
  });

  it("does not auto-open media when the receiver is in focus", () => {
    const focus = pixelInZone("zone-focus");
    const nearby = {
      x: focus.x + TILE_SIZE,
      y: focus.y,
      zoneId: zoneAtPixel(OFFICE_MAP, focus.x + TILE_SIZE, focus.y),
    };
    const decision = authorizeMediaSubscription(focus, nearby);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("FOCUS_RECEIVER");
  });
});

describe("authorizeStoredTrackPull", () => {
  it("never treats track knowledge as authorization", () => {
    const far = authorizeStoredTrackPull({
      subscriberUserId: "11111111-1111-1111-1111-111111111111",
      ownerUserId: "22222222-2222-2222-2222-222222222222",
      subscriber: { x: 0, y: 0, zoneId: "zone-desks" },
      publisher: { x: 2000, y: 2000, zoneId: "zone-rest" },
    });
    expect(far).toMatchObject({
      ok: false,
      error: "TRACK_NOT_AUTHORIZED",
      reason: "OUT_OF_RANGE",
    });
  });

  it("rejects a pull when the publisher is not present", () => {
    const missing = authorizeStoredTrackPull({
      subscriberUserId: "11111111-1111-1111-1111-111111111111",
      ownerUserId: "22222222-2222-2222-2222-222222222222",
      subscriber: { x: 100, y: 100, zoneId: null },
      publisher: null,
    });
    expect(missing.ok).toBe(false);
  });
});

describe("decideSpatialSubscription", () => {
  const sub = DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription;

  it("does not flap when walking the hysteresis band", () => {
    const publisher = { x: 0, y: 0, zoneId: null };
    const entered = decideSpatialSubscription({
      subscriber: { x: sub.subscribeRadius - 8, y: 0, zoneId: null },
      publisher,
      nowMs: 1_000,
      wasSubscribed: false,
      subscribedSinceMs: null,
      pendingUnsubscribeAtMs: null,
    });
    expect(entered.shouldSubscribe).toBe(true);

    let wasSubscribed = true;
    let subscribedSinceMs = entered.subscribedSinceMs;
    let pendingUnsubscribeAtMs = entered.pendingUnsubscribeAtMs;
    let unsubscribeCount = 0;

    for (let step = 0; step < 40; step += 1) {
      const inward = step % 2 === 0;
      const distance = inward
        ? sub.subscribeRadius + 8
        : sub.unsubscribeRadius - 8;
      const decision = decideSpatialSubscription({
        subscriber: { x: distance, y: 0, zoneId: null },
        publisher,
        nowMs: 5_000 + step * 50,
        wasSubscribed,
        subscribedSinceMs,
        pendingUnsubscribeAtMs,
      });
      if (wasSubscribed && !decision.shouldSubscribe) unsubscribeCount += 1;
      wasSubscribed = decision.shouldSubscribe;
      subscribedSinceMs = decision.subscribedSinceMs;
      pendingUnsubscribeAtMs = decision.pendingUnsubscribeAtMs;
    }

    expect(wasSubscribed).toBe(true);
    expect(unsubscribeCount).toBe(0);
  });

  it("revokes immediately when leaving a meeting", () => {
    const publisher = pixelInZone("zone-meeting");
    const inside = decideSpatialSubscription({
      subscriber: pixelInZone("zone-meeting"),
      publisher,
      nowMs: 1_000,
      wasSubscribed: false,
      subscribedSinceMs: null,
      pendingUnsubscribeAtMs: null,
    });
    expect(inside.shouldSubscribe).toBe(true);

    const left = decideSpatialSubscription({
      subscriber: hallwayNearMeeting(),
      publisher,
      nowMs: 1_100,
      wasSubscribed: true,
      subscribedSinceMs: 1_000,
      pendingUnsubscribeAtMs: null,
    });
    expect(left.shouldSubscribe).toBe(false);
    expect(left.reason).toBe("CLOSED_ROOM");
    expect(left.pendingUnsubscribeAtMs).toBeNull();
  });

  it("keeps a public subscription during unsubscribe delay, then drops it", () => {
    const publisher = { x: 0, y: 0, zoneId: null };
    const far = sub.unsubscribeRadius + 40;
    const pending = decideSpatialSubscription({
      subscriber: { x: far, y: 0, zoneId: null },
      publisher,
      nowMs: 10_000,
      wasSubscribed: true,
      subscribedSinceMs: 1_000,
      pendingUnsubscribeAtMs: null,
    });
    expect(pending.shouldSubscribe).toBe(true);
    expect(
      authorizeMediaSubscription({ x: far, y: 0, zoneId: null }, publisher)
        .allowed,
    ).toBe(false);

    const dropped = decideSpatialSubscription({
      subscriber: { x: far, y: 0, zoneId: null },
      publisher,
      nowMs: pending.pendingUnsubscribeAtMs! + 1,
      wasSubscribed: true,
      subscribedSinceMs: 1_000,
      pendingUnsubscribeAtMs: pending.pendingUnsubscribeAtMs,
    });
    expect(dropped.shouldSubscribe).toBe(false);
  });
});

describe("remote media cleanup contract", () => {
  it("drops audio and video elements when unsubscribed", () => {
    expect(remoteMediaShouldRender({ subscribed: false, kind: "audio" })).toBe(
      false,
    );
    expect(remoteMediaShouldRender({ subscribed: false, kind: "video" })).toBe(
      false,
    );
    expect(remoteMediaShouldRender({ subscribed: true, kind: "video" })).toBe(
      true,
    );
  });
});
