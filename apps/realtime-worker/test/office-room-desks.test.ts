import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import {
  deskInteractionPixel,
  findDeskById,
  issueRealtimeTicket,
  OFFICE_MAP,
  type ServerEvent,
  type SpatialAccessClass,
} from "@virtual-office/shared";

const worker = (
  exports as unknown as {
    default: {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  }
).default;
const SECRET = "test-signing-secret-at-least-thirty-two-characters";
const ORIGIN = "https://office.test";

const sockets: WebSocket[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function teleportTo(
  socket: WebSocket,
  target: { x: number; y: number },
  seq: number,
): Promise<void> {
  await sleep(2_500);
  const settled = Promise.race([
    nextEvent(socket, "player.updated"),
    nextEvent(socket, "player.corrected"),
  ]);
  move(socket, seq, Math.round(target.x), Math.round(target.y), false);
  await settled;
}

async function nextDeskOccupancy(
  socket: WebSocket,
): Promise<Extract<ServerEvent, { type: "player.updated" }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for desk occupancy")),
      8_000,
    );
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const parsed = JSON.parse(event.data) as ServerEvent;
      if (parsed.type === "error" && parsed.code.startsWith("DESK_")) {
        clearTimeout(timeout);
        socket.removeEventListener("message", handler);
        reject(new Error(parsed.code));
        return;
      }
      if (parsed.type === "player.updated" && parsed.player.currentDeskId) {
        clearTimeout(timeout);
        socket.removeEventListener("message", handler);
        resolve(parsed);
      }
    };
    socket.addEventListener("message", handler);
  });
}

async function nextEvent<T extends ServerEvent["type"]>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      8_000,
    );
    const handler = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const parsed = JSON.parse(event.data) as ServerEvent;
      if (parsed.type !== type) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handler);
      resolve(parsed as Extract<ServerEvent, { type: T }>);
    };
    socket.addEventListener("message", handler);
  });
}

function move(
  socket: WebSocket,
  seq: number,
  x: number,
  y: number,
  moving = false,
): void {
  socket.send(
    JSON.stringify({
      type: "player.move",
      seq,
      x,
      y,
      direction: "down",
      moving,
      clientTime: Date.now(),
    }),
  );
}

async function connect(
  officeId: string,
  userId: string,
  displayName: string,
  accessClass: SpatialAccessClass = "OFFICE_COLLABORATOR",
) {
  const ticket = await issueRealtimeTicket(
    { userId, officeId, displayName, accessClass },
    SECRET,
  );
  const response = await worker.fetch(
    `${ORIGIN}/office/${officeId}/connect?ticket=${encodeURIComponent(ticket)}`,
    { headers: { Upgrade: "websocket", Origin: ORIGIN } },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Worker did not return a WebSocket");
  socket.accept();
  sockets.push(socket);
  const snapshot = await nextEvent(socket, "office.snapshot");
  return { socket, snapshot };
}

function useDesk(socket: WebSocket, deskId: string): void {
  socket.send(
    JSON.stringify({
      type: "desk.use",
      deskId,
      clientTime: Date.now(),
    }),
  );
}

function uuid(): string {
  return crypto.randomUUID();
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000, "test cleanup");
});

describe("OfficeRoom workstations", () => {
  const testDeskId = "desk-5";

  it("N/I: activating a desk sets currentDeskId and moving clears it", async () => {
    const officeId = uuid();
    const desk = findDeskById(OFFICE_MAP, testDeskId);
    expect(desk).not.toBeNull();
    const point = deskInteractionPixel(desk!);

    const observer = await connect(officeId, uuid(), "Observador");
    const joined = nextEvent(observer.socket, "player.joined");
    const workerClient = await connect(officeId, uuid(), "Trabajador");
    await joined;

    await teleportTo(workerClient.socket, point, 1);
    await sleep(80);

    useDesk(workerClient.socket, testDeskId);
    const atDesk = await nextDeskOccupancy(workerClient.socket);
    expect(atDesk.player.currentDeskId).toBe(testDeskId);

    await sleep(2_500);
    move(workerClient.socket, 2, point.x + 48, point.y);
    const cleared = await nextEvent(workerClient.socket, "player.updated");
    expect(cleared.player.currentDeskId ?? null).toBeNull();
  }, 20_000);

  it("H/J: exclusive occupancy and disconnect release desk", async () => {
    const officeId = uuid();
    const desk = findDeskById(OFFICE_MAP, testDeskId);
    const point = deskInteractionPixel(desk!);

    const first = await connect(officeId, uuid(), "Primero");
    await teleportTo(first.socket, point, 1);
    await sleep(80);

    useDesk(first.socket, testDeskId);
    await nextEvent(first.socket, "player.updated");

    const second = await connect(officeId, uuid(), "Segundo");
    await teleportTo(second.socket, point, 1);
    await sleep(80);

    const blocked = nextEvent(second.socket, "error");
    useDesk(second.socket, testDeskId);
    const error = await blocked;
    expect(error.code).toBe("DESK_DESK_OCCUPIED");

    const left = nextEvent(second.socket, "player.left");
    first.socket.close(1000, "bye");
    await left;

    const reclaimed = nextEvent(second.socket, "player.updated");
    useDesk(second.socket, testDeskId);
    const occupied = await reclaimed;
    expect(occupied.player.currentDeskId).toBe(testDeskId);
  }, 20_000);

  it("K: reconnect does not duplicate desk occupancy", async () => {
    const officeId = uuid();
    const userId = uuid();
    const desk = findDeskById(OFFICE_MAP, testDeskId);
    const point = deskInteractionPixel(desk!);

    const firstTab = await connect(officeId, userId, "Tab A");
    await teleportTo(firstTab.socket, point, 1);
    await sleep(80);
    useDesk(firstTab.socket, testDeskId);
    await nextEvent(firstTab.socket, "player.updated");

    const replaced = new Promise<number>((resolve) => {
      firstTab.socket.addEventListener("close", (event) => resolve(event.code));
    });
    const secondTab = await connect(officeId, userId, "Tab B");
    await expect(replaced).resolves.toBe(4001);

    const self = secondTab.snapshot.players.find(
      (player) => player.userId === userId,
    );
    expect(self?.currentDeskId ?? null).toBeNull();
    expect(
      secondTab.snapshot.players.filter((player) => player.currentDeskId)
        .length,
    ).toBe(0);
  }, 20_000);

  it("F: club member cannot activate a workstation", async () => {
    const officeId = uuid();
    const clubMember = await connect(
      officeId,
      uuid(),
      "Miembro",
      "CLUB_MEMBER",
    );

    const denied = nextEvent(clubMember.socket, "error");
    useDesk(clubMember.socket, "desk-1");
    const error = await denied;
    expect(error.code).toBe("DESK_OFFICE_ACCESS_DENIED");
  });
});
