import { describe, expect, it } from "vitest";

import {
  authorizeMediaSubscription,
  authorizeStoredTrackPull,
  canActivateManualSpeaker,
  canBroadcastByZone,
  canBeManualSpeakerTarget,
  canModerateManualSpeaker,
  countEffectiveBroadcastSpeakers,
  decideSpatialSubscription,
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  OFFICE_MAP,
  reconcileZoneBroadcastSpeakers,
  TILE_SIZE,
  zoneAtPixel,
  type BroadcastAttachmentState,
  type SpatialAccessClass,
} from "../src/index";

function pixelInZone(zoneId: string): { x: number; y: number; zoneId: string } {
  const zone = OFFICE_MAP.zones.find((item) => item.zoneId === zoneId)!;
  const x = (zone.x + Math.floor(zone.width / 2)) * TILE_SIZE + TILE_SIZE / 2;
  const y = (zone.y + Math.floor(zone.height / 2)) * TILE_SIZE + TILE_SIZE / 2;
  return { x, y, zoneId };
}

function attachment(
  userId: string,
  zoneId: string | null,
  accessClass: SpatialAccessClass,
  zoneBroadcastActive = false,
  manualBroadcastSpeaker = false,
): BroadcastAttachmentState {
  return {
    userId,
    accessClass,
    zoneId,
    zoneBroadcastActive,
    manualBroadcastSpeaker,
  };
}

describe("Sprint 6 broadcast zone primitive", () => {
  const campfire = OFFICE_MAP.zones.find(
    (zone) => zone.zoneId === "zone-campfire",
  )!;

  it("A: club member outside broadcast zone is not a zone speaker", () => {
    const commons = pixelInZone("zone-commons");
    const states = reconcileZoneBroadcastSpeakers(
      [attachment("user-a", commons.zoneId, "CLUB_MEMBER")],
      OFFICE_MAP,
    );
    expect(states.has("user-a")).toBe(false);
  });

  it("B: club member entering broadcast zone becomes active speaker", () => {
    const states = reconcileZoneBroadcastSpeakers(
      [attachment("user-a", campfire.zoneId, "CLUB_MEMBER")],
      OFFICE_MAP,
    );
    expect(states.get("user-a")?.active).toBe(true);
  });

  it("C: staff entering broadcast zone becomes active speaker", () => {
    const states = reconcileZoneBroadcastSpeakers(
      [attachment("staff", campfire.zoneId, "RECUERDA_STAFF")],
      OFFICE_MAP,
    );
    expect(states.get("staff")?.active).toBe(true);
  });

  it("D: office collaborator in broadcast zone is not eligible", () => {
    expect(canBroadcastByZone("OFFICE_COLLABORATOR")).toBe(false);
    const states = reconcileZoneBroadcastSpeakers(
      [attachment("collab", campfire.zoneId, "OFFICE_COLLABORATOR")],
      OFFICE_MAP,
    );
    expect(states.get("collab")).toBeUndefined();
  });

  it("E: exiting broadcast zone removes zone speaker state", () => {
    const before = reconcileZoneBroadcastSpeakers(
      [attachment("user-a", campfire.zoneId, "CLUB_MEMBER", true)],
      OFFICE_MAP,
    );
    expect(before.get("user-a")?.active).toBe(true);
    const after = reconcileZoneBroadcastSpeakers(
      [attachment("user-a", "zone-commons", "CLUB_MEMBER", true)],
      OFFICE_MAP,
    );
    expect(after.get("user-a")).toBeUndefined();
  });
});

describe("Sprint 6 broadcast media routing", () => {
  const campfire = pixelInZone("zone-campfire");
  const farAway = pixelInZone("zone-cowork");
  const broadcasters = new Set(["speaker-a"]);

  it("I: far listener receives broadcast audio authorization", () => {
    const decision = authorizeMediaSubscription(
      farAway,
      campfire,
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
      undefined,
      {
        trackKind: "audio",
        publisherUserId: "speaker-a",
        broadcastSpeakerUserIds: broadcasters,
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("ROOM_BROADCAST");
    expect(decision.ignoreDistance).toBe(true);
  });

  it("J: broadcast video remains proximity-only", () => {
    const decision = authorizeMediaSubscription(
      farAway,
      campfire,
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
      undefined,
      {
        trackKind: "video",
        publisherUserId: "speaker-a",
        broadcastSpeakerUserIds: broadcasters,
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("OUT_OF_RANGE");
  });

  it("K: nearby listener with broadcast uses one subscription path", () => {
    const near = {
      x: campfire.x + TILE_SIZE,
      y: campfire.y,
      zoneId: campfire.zoneId,
    };
    const audio = decideSpatialSubscription(
      {
        subscriber: near,
        publisher: campfire,
        nowMs: 0,
        wasSubscribed: false,
        subscribedSinceMs: null,
        pendingUnsubscribeAtMs: null,
      },
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
      undefined,
      {
        trackKind: "audio",
        publisherUserId: "speaker-a",
        broadcastSpeakerUserIds: broadcasters,
      },
    );
    expect(audio.shouldSubscribe).toBe(true);
    expect(audio.reason).toBe("ROOM_BROADCAST");
  });

  it("L: broadcast ends while still near keeps proximity subscription", () => {
    const near = {
      x: campfire.x + TILE_SIZE,
      y: campfire.y,
      zoneId: campfire.zoneId,
    };
    const decision = decideSpatialSubscription(
      {
        subscriber: near,
        publisher: campfire,
        nowMs: 1_000,
        wasSubscribed: true,
        subscribedSinceMs: 0,
        pendingUnsubscribeAtMs: null,
      },
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
    );
    expect(decision.shouldSubscribe).toBe(true);
    expect(decision.reason).toBe("NEARBY");
  });

  it("M: broadcast ends while far unsubscribes", () => {
    const decision = decideSpatialSubscription(
      {
        subscriber: farAway,
        publisher: campfire,
        nowMs: 1_000,
        wasSubscribed: true,
        subscribedSinceMs: 0,
        pendingUnsubscribeAtMs: null,
      },
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
      undefined,
      {
        trackKind: "audio",
        publisherUserId: "speaker-a",
        broadcastSpeakerUserIds: new Set(),
      },
    );
    expect(decision.shouldSubscribe).toBe(false);
  });

  it("N: broadcast audio ignores distance attenuation", () => {
    const decision = authorizeMediaSubscription(
      farAway,
      campfire,
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
      undefined,
      {
        trackKind: "audio",
        publisherUserId: "speaker-a",
        broadcastSpeakerUserIds: broadcasters,
      },
    );
    expect(decision.ignoreDistance).toBe(true);
  });
});

describe("Sprint 6 manual speaker", () => {
  const campfire = OFFICE_MAP.zones.find(
    (zone) => zone.zoneId === "zone-campfire",
  )!;

  it("P: staff can set eligible club member as manual speaker", () => {
    expect(canModerateManualSpeaker("RECUERDA_STAFF")).toBe(true);
    expect(canBeManualSpeakerTarget("CLUB_MEMBER")).toBe(true);
    const decision = canActivateManualSpeaker({
      attachments: [
        attachment("staff", "zone-commons", "RECUERDA_STAFF"),
        attachment("member", "zone-commons", "CLUB_MEMBER"),
      ],
      map: OFFICE_MAP,
      targetUserId: "member",
    });
    expect(decision.allowed).toBe(true);
  });

  it("Q: club member cannot moderate manual speaker", () => {
    expect(canModerateManualSpeaker("CLUB_MEMBER")).toBe(false);
  });

  it("R: staff cannot make office collaborator manual speaker", () => {
    const decision = canActivateManualSpeaker({
      attachments: [
        attachment("collab", campfire.zoneId, "OFFICE_COLLABORATOR"),
      ],
      map: OFFICE_MAP,
      targetUserId: "collab",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("TARGET_NOT_ELIGIBLE");
    }
  });

  it("S: missing target is rejected", () => {
    const decision = canActivateManualSpeaker({
      attachments: [attachment("staff", "zone-commons", "RECUERDA_STAFF")],
      map: OFFICE_MAP,
      targetUserId: "missing-user",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("TARGET_NOT_FOUND");
    }
  });
});

describe("Sprint 6 broadcast capacity", () => {
  const campfire = OFFICE_MAP.zones.find(
    (zone) => zone.zoneId === "zone-campfire",
  )!;

  it("V: effective speaker count follows active flags", () => {
    const attachments = [
      attachment("a", campfire.zoneId, "CLUB_MEMBER", true),
      attachment("b", campfire.zoneId, "CLUB_MEMBER", true),
    ];
    expect(countEffectiveBroadcastSpeakers(attachments)).toBe(2);
  });

  it("W: second zone entrant is capacity blocked when max is 1", () => {
    const states = reconcileZoneBroadcastSpeakers(
      [
        attachment("a", campfire.zoneId, "CLUB_MEMBER", true),
        attachment("d", campfire.zoneId, "CLUB_MEMBER"),
      ],
      OFFICE_MAP,
    );
    expect(states.get("a")?.active).toBe(true);
    expect(states.get("d")?.active).toBe(false);
    expect(states.get("d")?.capacityBlocked).toBe(true);
  });

  it("X: removing the speaker frees capacity immediately", () => {
    const states = reconcileZoneBroadcastSpeakers(
      [attachment("d", campfire.zoneId, "CLUB_MEMBER")],
      OFFICE_MAP,
    );
    expect(states.get("d")?.active).toBe(true);
  });

  it("Y: zone + manual for same user counts once", () => {
    const attachments = [
      attachment("a", campfire.zoneId, "CLUB_MEMBER", true, true),
    ];
    expect(countEffectiveBroadcastSpeakers(attachments)).toBe(1);
  });
});

describe("Sprint 6 campfire map config", () => {
  it("campfire uses generic broadcast zone metadata", () => {
    const campfire = OFFICE_MAP.zones.find(
      (zone) => zone.zoneId === "zone-campfire",
    );
    expect(campfire?.zoneType).toBe("broadcast");
    expect(campfire?.broadcastConfig).toEqual({
      scope: "room",
      maxSpeakers: 1,
      audio: true,
      video: false,
    });
    expect(campfire?.width).toBe(2);
    expect(campfire?.height).toBe(2);
    expect(campfire?.editor?.movable).toBe(true);
    const plaza = OFFICE_MAP.zones.find(
      (zone) => zone.zoneId === "zone-campfire-plaza",
    );
    expect(plaza?.zoneType).toBe("plaza");
    expect(plaza?.width).toBeGreaterThan(campfire!.width);
    expect(plaza?.editor?.movable).toBe(true);
  });

  it("zoneAtPixel prefers the smallest overlapping zone", () => {
    const point = pixelInZone("zone-campfire");
    expect(zoneAtPixel(OFFICE_MAP, point.x, point.y)).toBe("zone-campfire");
  });

  it("stored track pull authorizes broadcast audio only", () => {
    const listener = pixelInZone("zone-cowork");
    const speaker = pixelInZone("zone-campfire");
    const audio = authorizeStoredTrackPull({
      subscriberUserId: "listener",
      ownerUserId: "speaker",
      subscriber: listener,
      publisher: speaker,
      trackKind: "audio",
      broadcastSpeakerUserIds: new Set(["speaker"]),
    });
    const video = authorizeStoredTrackPull({
      subscriberUserId: "listener",
      ownerUserId: "speaker",
      subscriber: listener,
      publisher: speaker,
      trackKind: "video",
      broadcastSpeakerUserIds: new Set(["speaker"]),
    });
    expect(audio.ok).toBe(true);
    if (audio.ok) expect(audio.reason).toBe("ROOM_BROADCAST");
    expect(video.ok).toBe(false);
  });

  it("office atmosphere does not receive campfire broadcast", () => {
    const listener = pixelInZone("zone-office");
    const speaker = pixelInZone("zone-campfire");
    const audio = authorizeMediaSubscription(
      listener,
      speaker,
      DEFAULT_PROXIMITY_MEDIA_CONFIG,
      OFFICE_MAP,
      undefined,
      {
        trackKind: "audio",
        publisherUserId: "speaker",
        broadcastSpeakerUserIds: new Set(["speaker"]),
      },
    );
    expect(audio.allowed).toBe(false);
  });
});
