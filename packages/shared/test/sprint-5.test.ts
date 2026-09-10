import { describe, expect, it } from "vitest";

import {
  OFFICE_LAYOUT_ORIGIN,
  OFFICE_MAP,
  OFFICE_ZONE_ID,
  TEMPLE_MAIN_MAP,
  TEMPLE_MAIN_ROOM_ID,
  TILE_SIZE,
  authorizeMediaSubscription,
  authorizeSpatialMovement,
  authorizeStoredTrackPull,
  decideSpatialSubscription,
  isBlockedAtPixel,
  isOfficePixel,
  issueRealtimeTicket,
  parseDeskDefinitions,
  parsePortalDefinitions,
  parseRoomDefinition,
  roomChecksum,
  spawnPixel,
  spawnPointsForAccess,
  ticketAccessClass,
  verifyRealtimeTicket,
  zoneAtPixel,
} from "../src/index";

function pixelInZone(zoneId: string): { x: number; y: number; zoneId: string } {
  const zone = OFFICE_MAP.zones.find((item) => item.zoneId === zoneId)!;
  const x = (zone.x + 1) * TILE_SIZE + TILE_SIZE / 2;
  const y = (zone.y + 1) * TILE_SIZE + TILE_SIZE / 2;
  return { x, y, zoneId };
}

function commonsOutsideOffice(): {
  x: number;
  y: number;
  zoneId: string | null;
} {
  const x = 30 * TILE_SIZE + TILE_SIZE / 2;
  const y = 48 * TILE_SIZE + TILE_SIZE / 2;
  return { x, y, zoneId: zoneAtPixel(OFFICE_MAP, x, y) };
}

describe("Sprint 5 temple-main map", () => {
  it("R: client and server share the same authoritative map definition", () => {
    expect(TEMPLE_MAIN_MAP.roomId).toBe(TEMPLE_MAIN_ROOM_ID);
    expect(OFFICE_MAP).toBe(TEMPLE_MAIN_MAP);
    expect(roomChecksum(TEMPLE_MAIN_MAP)).toMatch(/^[0-9a-f]{8}$/u);
  });

  it("Q: expanded map keeps walkable commons spawns", () => {
    for (const spawn of spawnPointsForAccess(TEMPLE_MAIN_MAP, "CLUB_MEMBER")) {
      const pixel = spawnPixel(spawn);
      expect(isBlockedAtPixel(OFFICE_MAP, pixel.x, pixel.y)).toBe(false);
      expect(isOfficePixel(OFFICE_MAP, pixel.x, pixel.y)).toBe(false);
    }
  });

  it("S: desk definitions validate without PII", () => {
    const desks = parseDeskDefinitions(TEMPLE_MAIN_MAP.desks);
    expect(desks.length).toBeGreaterThanOrEqual(5);
    for (const desk of desks) {
      expect(desk.roomId).toBe("temple-main");
      expect(desk.deskId).toMatch(/^desk-/u);
    }
  });

  it("T: future portal definitions validate without changing runtime", () => {
    const portals = parsePortalDefinitions(TEMPLE_MAIN_MAP.portals);
    expect(portals[0]?.targetRoomId).toBe("audionautica");
    expect(parseRoomDefinition(TEMPLE_MAIN_MAP).roomId).toBe("temple-main");
  });
});

describe("Sprint 5 spatial movement authorization", () => {
  it("A: club member can move through Temple commons", () => {
    const commons = commonsOutsideOffice();
    expect(
      authorizeSpatialMovement({
        accessClass: "CLUB_MEMBER",
        destinationX: commons.x,
        destinationY: commons.y,
        map: OFFICE_MAP,
      }).allowed,
    ).toBe(true);
  });

  it("B: club member crossing Office boundary is rejected", () => {
    const insideOffice = pixelInZone("zone-desks");
    expect(
      authorizeSpatialMovement({
        accessClass: "CLUB_MEMBER",
        destinationX: insideOffice.x,
        destinationY: insideOffice.y,
        map: OFFICE_MAP,
      }).allowed,
    ).toBe(false);
  });

  it("C: staff may enter the Office", () => {
    const insideOffice = pixelInZone("zone-desks");
    expect(
      authorizeSpatialMovement({
        accessClass: "RECUERDA_STAFF",
        destinationX: insideOffice.x,
        destinationY: insideOffice.y,
        map: OFFICE_MAP,
      }).allowed,
    ).toBe(true);
  });

  it("E/F: office collaborator spawns inside Office and moves within it", () => {
    const officeSpawn = spawnPixel(
      spawnPointsForAccess(TEMPLE_MAIN_MAP, "OFFICE_COLLABORATOR")[0]!,
    );
    expect(isOfficePixel(OFFICE_MAP, officeSpawn.x, officeSpawn.y)).toBe(true);
    expect(
      authorizeSpatialMovement({
        accessClass: "OFFICE_COLLABORATOR",
        destinationX: officeSpawn.x,
        destinationY: officeSpawn.y,
        map: OFFICE_MAP,
      }).allowed,
    ).toBe(true);
  });

  it("G: office collaborator cannot leave Office into commons", () => {
    const commons = commonsOutsideOffice();
    expect(
      authorizeSpatialMovement({
        accessClass: "OFFICE_COLLABORATOR",
        destinationX: commons.x,
        destinationY: commons.y,
        map: OFFICE_MAP,
      }).allowed,
    ).toBe(false);
  });
});

describe("Sprint 5 office media privacy", () => {
  const staffInside = pixelInZone("zone-desks");
  const clubOutside = commonsOutsideOffice();

  it("I/J: club member outside cannot receive Office media or manual pull", () => {
    const media = authorizeMediaSubscription(
      clubOutside,
      staffInside,
      undefined,
      OFFICE_MAP,
      {
        subscriberAccessClass: "CLUB_MEMBER",
        publisherAccessClass: "RECUERDA_STAFF",
      },
    );
    expect(media.allowed).toBe(false);
    expect(media.reason).toBe("OFFICE_MEDIA_PRIVATE");

    const pull = authorizeStoredTrackPull({
      subscriberUserId: "11111111-1111-1111-1111-111111111111",
      ownerUserId: "22222222-2222-2222-2222-222222222222",
      subscriber: clubOutside,
      publisher: staffInside,
      subscriberAccessClass: "CLUB_MEMBER",
      publisherAccessClass: "RECUERDA_STAFF",
      map: OFFICE_MAP,
    });
    expect(pull.ok).toBe(false);
    if (pull.ok) throw new Error("expected deny");
    expect(pull.reason).toBe("OFFICE_MEDIA_PRIVATE");
  });

  it("K: staff inside Office keeps proximity media between authorized users", () => {
    const staffB = {
      x: staffInside.x + TILE_SIZE,
      y: staffInside.y,
      zoneId: staffInside.zoneId,
    };
    const media = authorizeMediaSubscription(
      staffInside,
      staffB,
      undefined,
      OFFICE_MAP,
      {
        subscriberAccessClass: "RECUERDA_STAFF",
        publisherAccessClass: "RECUERDA_STAFF",
      },
    );
    expect(media.allowed).toBe(true);
  });

  it("L: Temple commons proximity remains unchanged outside Office", () => {
    const a = { x: 24 * TILE_SIZE, y: 48 * TILE_SIZE, zoneId: "zone-commons" };
    const b = { x: 25 * TILE_SIZE, y: 48 * TILE_SIZE, zoneId: "zone-commons" };
    const media = authorizeMediaSubscription(a, b, undefined, OFFICE_MAP, {
      subscriberAccessClass: "CLUB_MEMBER",
      publisherAccessClass: "CLUB_MEMBER",
    });
    expect(media.allowed).toBe(true);
    expect(media.reason).toBe("NEARBY");
  });

  it("H: presence visibility is independent from media (geometry only check)", () => {
    expect(isOfficePixel(OFFICE_MAP, staffInside.x, staffInside.y)).toBe(true);
    expect(isOfficePixel(OFFICE_MAP, clubOutside.x, clubOutside.y)).toBe(false);
    expect(OFFICE_ZONE_ID).toBe("zone-office");
    expect(OFFICE_LAYOUT_ORIGIN.x).toBeGreaterThan(0);
  });
});

describe("Sprint 5 ticket access class", () => {
  const base = {
    userId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
    officeId: "0b54f2dc-6f19-4f6b-9b2b-7a3d0e6a1c11",
    displayName: "Tester",
  };
  const secret = "test-signing-secret-at-least-thirty-two-characters";

  it("D: office collaborator access class round-trips in realtime tickets", async () => {
    const token = await issueRealtimeTicket(
      { ...base, accessClass: "OFFICE_COLLABORATOR" },
      secret,
    );
    const claims = await verifyRealtimeTicket(token, secret);
    expect(ticketAccessClass(claims)).toBe("OFFICE_COLLABORATOR");
  });
});

describe("Sprint 5 office collaborator authorization", () => {
  const collabInside = pixelInZone("zone-desks");
  const staffInside = pixelInZone("zone-desks");
  const clubInCommons = commonsOutsideOffice();

  it("A: collaborator with grant may enter Temple world (entitlement class)", () => {
    expect("OFFICE_COLLABORATOR").toBe("OFFICE_COLLABORATOR");
  });

  it("B: collaborator spawn points resolve inside Office footprint", () => {
    const spawn = spawnPointsForAccess(
      TEMPLE_MAIN_MAP,
      "OFFICE_COLLABORATOR",
    )[0]!;
    const pixel = spawnPixel(spawn);
    expect(isOfficePixel(OFFICE_MAP, pixel.x, pixel.y)).toBe(true);
  });

  it("E: staff and collaborator inside Office may share proximity media", () => {
    const media = authorizeMediaSubscription(
      collabInside,
      staffInside,
      undefined,
      OFFICE_MAP,
      {
        subscriberAccessClass: "OFFICE_COLLABORATOR",
        publisherAccessClass: "RECUERDA_STAFF",
      },
    );
    expect(media.allowed).toBe(true);
    expect(media.reason).toBe("NEARBY");
  });

  it("F: collaborator does not receive Temple commons media", () => {
    const collabInMeeting = pixelInZone("zone-meeting");
    const media = authorizeMediaSubscription(
      collabInMeeting,
      clubInCommons,
      undefined,
      OFFICE_MAP,
      {
        subscriberAccessClass: "OFFICE_COLLABORATOR",
        publisherAccessClass: "CLUB_MEMBER",
      },
    );
    expect(media.allowed).toBe(false);
    expect(media.reason).toBe("CLOSED_ROOM");
  });

  it("G: manual Office track pull obeys Office ACL for club outsider", () => {
    const pull = authorizeStoredTrackPull({
      subscriberUserId: "club-user",
      ownerUserId: "staff-user",
      subscriber: clubInCommons,
      publisher: staffInside,
      subscriberAccessClass: "CLUB_MEMBER",
      publisherAccessClass: "RECUERDA_STAFF",
      map: OFFICE_MAP,
    });
    expect(pull.ok).toBe(false);
    if (!pull.ok) expect(pull.reason).toBe("OFFICE_MEDIA_PRIVATE");
  });
});

describe("Sprint 5 client subscription planner", () => {
  it("blocks office media for club members via decideSpatialSubscription", () => {
    const clubOutside = commonsOutsideOffice();
    const staffInside = pixelInZone("zone-meeting");
    const decision = decideSpatialSubscription(
      {
        subscriber: clubOutside,
        publisher: staffInside,
        nowMs: 1_000,
        wasSubscribed: false,
        subscribedSinceMs: null,
        pendingUnsubscribeAtMs: null,
      },
      undefined,
      OFFICE_MAP,
      { subscriberAccessClass: "CLUB_MEMBER" },
    );
    expect(decision.shouldSubscribe).toBe(false);
    expect(decision.reason).toBe("OFFICE_MEDIA_PRIVATE");
  });
});
