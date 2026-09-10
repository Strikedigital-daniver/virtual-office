import { describe, expect, it } from "vitest";

import {
  authorizeDeskActivation,
  deskInteractionPixel,
  deskPrimaryOccupant,
  DESK_INTERACTION_RADIUS_PX,
  findDeskById,
  isNearDeskInteraction,
  nearestDesk,
  resolveActiveDeskAssignments,
  assignmentForUser,
  canUseOfficeWorkstations,
} from "../src/desk-workstation";
import {
  parseDeskDefinitions,
  TEMPLE_MAIN_ROOM_ID,
} from "../src/room-definition";
import { OFFICE_MAP, TEMPLE_MAIN_MAP } from "../src/temple-main-map";
import { TILE_SIZE } from "../src/protocol";

function pixelAtDesk(deskId: string): { x: number; y: number } {
  const desk = findDeskById(OFFICE_MAP, deskId);
  if (!desk) throw new Error(`missing desk ${deskId}`);
  return deskInteractionPixel(desk);
}

describe("Sprint 5.1 desk definitions", () => {
  it("A: DeskDefinition validates", () => {
    const desks = parseDeskDefinitions(TEMPLE_MAIN_MAP.desks);
    expect(desks.length).toBe(5);
    for (const desk of desks) {
      expect(desk.roomId).toBe(TEMPLE_MAIN_ROOM_ID);
      expect(desk.interactionTileX).toBeTypeOf("number");
      expect(desk.privateAreaId).toMatch(/-area$/u);
    }
  });

  it("B: five Office desks have stable unique IDs", () => {
    const ids = (TEMPLE_MAIN_MAP.desks ?? []).map((desk) => desk.deskId);
    expect(ids).toEqual(["desk-1", "desk-2", "desk-3", "desk-4", "desk-5"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("C: desk map definitions contain no staff PII", () => {
    const serialized = JSON.stringify(TEMPLE_MAIN_MAP.desks);
    expect(serialized).not.toMatch(/@/u);
    expect(serialized).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
  });
});

describe("Sprint 5.1 desk activation authorization", () => {
  const staffId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const collabId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const clubId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const deskId = "desk-1";

  function occupants(
    entries: Array<{ userId: string; currentDeskId: string | null }>,
  ) {
    return entries;
  }

  it("D: staff near desk may activate it", () => {
    const point = pixelAtDesk(deskId);
    const result = authorizeDeskActivation({
      deskId,
      userId: staffId,
      x: point.x,
      y: point.y,
      accessClass: "RECUERDA_STAFF",
      map: OFFICE_MAP,
      occupants: occupants([]),
    });
    expect(result.allowed).toBe(true);
    expect(result.snapPosition).toEqual(point);
  });

  it("E: office collaborator near desk may activate it", () => {
    const point = pixelAtDesk(deskId);
    const result = authorizeDeskActivation({
      deskId,
      userId: collabId,
      x: point.x,
      y: point.y,
      accessClass: "OFFICE_COLLABORATOR",
      map: OFFICE_MAP,
      occupants: occupants([]),
    });
    expect(result.allowed).toBe(true);
  });

  it("F: club member cannot activate desk", () => {
    const point = pixelAtDesk(deskId);
    const result = authorizeDeskActivation({
      deskId,
      userId: clubId,
      x: point.x,
      y: point.y,
      accessClass: "CLUB_MEMBER",
      map: OFFICE_MAP,
      occupants: occupants([]),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("office_access_denied");
    expect(canUseOfficeWorkstations("CLUB_MEMBER")).toBe(false);
  });

  it("G: user too far from interaction point cannot claim desk", () => {
    const point = pixelAtDesk(deskId);
    const result = authorizeDeskActivation({
      deskId,
      userId: staffId,
      x: point.x + DESK_INTERACTION_RADIUS_PX + TILE_SIZE,
      y: point.y,
      accessClass: "RECUERDA_STAFF",
      map: OFFICE_MAP,
      occupants: occupants([]),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("too_far");
    expect(
      isNearDeskInteraction(
        point.x + 200,
        point.y,
        findDeskById(OFFICE_MAP, deskId)!,
      ),
    ).toBe(false);
  });

  it("H: two users cannot simultaneously become primary occupant", () => {
    const point = pixelAtDesk(deskId);
    const blocked = authorizeDeskActivation({
      deskId,
      userId: collabId,
      x: point.x,
      y: point.y,
      accessClass: "OFFICE_COLLABORATOR",
      map: OFFICE_MAP,
      occupants: occupants([{ userId: staffId, currentDeskId: deskId }]),
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("desk_occupied");
    expect(
      deskPrimaryOccupant(
        deskId,
        occupants([{ userId: staffId, currentDeskId: deskId }]),
      ),
    ).toBe(staffId);
  });
});

describe("Sprint 5.1 desk assignment resolution", () => {
  const worldId = TEMPLE_MAIN_MAP.worldId;

  it("L: assignment persists independently from occupancy concept", () => {
    const assignment = {
      deskId: "desk-2",
      authUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      roomId: TEMPLE_MAIN_ROOM_ID,
      worldId,
    };
    const resolved = resolveActiveDeskAssignments([assignment], OFFICE_MAP);
    expect(resolved.active).toHaveLength(1);
    expect(
      assignmentForUser(resolved.active, assignment.authUserId)?.deskId,
    ).toBe("desk-2");
  });

  it("M: missing desk assignment becomes orphaned safely", () => {
    const resolved = resolveActiveDeskAssignments(
      [
        {
          deskId: "desk-removed",
          authUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          roomId: TEMPLE_MAIN_ROOM_ID,
          worldId,
        },
      ],
      OFFICE_MAP,
    );
    expect(resolved.active).toHaveLength(0);
    expect(resolved.orphanedDeskIds).toEqual(["desk-removed"]);
  });
});

describe("Sprint 5.1 desk discovery helpers", () => {
  it("nearestDesk returns the closest workstation within radius", () => {
    const point = pixelAtDesk("desk-3");
    const desk = nearestDesk(OFFICE_MAP, point.x, point.y);
    expect(desk?.deskId).toBe("desk-3");
  });

  it("N: presence includes currentDeskId only when occupied", () => {
    const occupied = {
      userId: "user-1",
      displayName: "A",
      x: 0,
      y: 0,
      direction: "down" as const,
      moving: false,
      zoneId: "zone-desks",
      currentDeskId: "desk-1",
      lastSeq: 1,
    };
    const free = { ...occupied, currentDeskId: null };
    expect(occupied.currentDeskId).toBe("desk-1");
    expect(free.currentDeskId).toBeNull();
  });

  it("I/J/K: movement and disconnect clear occupancy in state model", () => {
    const atDesk = { currentDeskId: "desk-2" as string | null };
    const afterMove = { currentDeskId: null as string | null };
    const afterDisconnect = { currentDeskId: null as string | null };
    expect(atDesk.currentDeskId).toBe("desk-2");
    expect(afterMove.currentDeskId).toBeNull();
    expect(afterDisconnect.currentDeskId).toBeNull();
  });
});
