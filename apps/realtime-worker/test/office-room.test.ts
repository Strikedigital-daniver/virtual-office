import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import {
  issueRealtimeTicket,
  spawnFor,
  spawnPixel,
  OFFICE_MAP,
  type ServerEvent,
} from "@virtual-office/shared";

import type { Env } from "../src/env";

const worker = (
  exports as unknown as {
    default: {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  }
).default;
const bindings = env as unknown as Env;
const SECRET = "test-signing-secret-at-least-thirty-two-characters";
const ORIGIN = "https://office.test";

const sockets: WebSocket[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nextEvent<T extends ServerEvent["type"]>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      3_000,
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

async function connect(officeId: string, userId: string, displayName: string) {
  const ticket = await issueRealtimeTicket(
    { userId, officeId, displayName },
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

function move(
  socket: WebSocket,
  seq: number,
  x: number,
  y: number,
  moving = true,
): void {
  socket.send(
    JSON.stringify({
      type: "player.move",
      seq,
      x,
      y,
      direction: "right",
      moving,
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

describe("OfficeRoom presence", () => {
  it("rejects a bad ticket and a ticket for another office", async () => {
    const officeId = uuid();
    const badTicket = await worker.fetch(
      `${ORIGIN}/office/${officeId}/connect?ticket=not-a-ticket`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    expect(badTicket.status).toBe(401);

    const foreign = await issueRealtimeTicket(
      { userId: uuid(), officeId: uuid(), displayName: "Intruso" },
      SECRET,
    );
    const mismatch = await worker.fetch(
      `${ORIGIN}/office/${officeId}/connect?ticket=${encodeURIComponent(foreign)}`,
      { headers: { Upgrade: "websocket", Origin: ORIGIN } },
    );
    expect(mismatch.status).toBe(403);
  });

  it("synchronizes movement between two users with server-derived zones", async () => {
    const officeId = uuid();
    const first = await connect(officeId, uuid(), "Primera");
    expect(first.snapshot.players).toHaveLength(1);
    expect(first.snapshot.players[0]?.zoneId).toBeNull();

    const joined = nextEvent(first.socket, "player.joined");
    const second = await connect(officeId, uuid(), "Segunda");
    expect(second.snapshot.players).toHaveLength(2);
    await joined;

    const spawn = spawnPixel(spawnFor(OFFICE_MAP, 1));
    const updated = nextEvent(first.socket, "player.updated");
    move(second.socket, 1, spawn.x + 16, spawn.y);
    const event = await updated;
    expect(event.player.displayName).toBe("Segunda");
    expect(event.player.x).toBe(spawn.x + 16);
    expect(event.player.lastSeq).toBe(1);
  });

  it("corrects teleports, out-of-bounds and collisions instead of applying them", async () => {
    const officeId = uuid();
    const client = await connect(officeId, uuid(), "Tramposa");
    const spawn = spawnPixel(spawnFor(OFFICE_MAP, 0));

    const speed = nextEvent(client.socket, "player.corrected");
    move(client.socket, 1, spawn.x + 500, spawn.y);
    expect((await speed).reason).toBe("speed");

    const bounds = nextEvent(client.socket, "player.corrected");
    move(client.socket, 2, 4, 4);
    expect((await bounds).reason).toBe("bounds");

    let seq = 2;
    let y = spawn.y;
    while (y < 726) {
      await sleep(120);
      y = Math.min(y + 24, 726);
      seq += 1;
      move(client.socket, seq, spawn.x, y);
      await nextEvent(client.socket, "player.updated");
    }
    await sleep(120);
    const collision = nextEvent(client.socket, "player.corrected");
    move(client.socket, seq + 1, spawn.x, 745);
    expect((await collision).reason).toBe("collision");
  });

  it("replaces a duplicated tab, survives eviction and reports leave once", async () => {
    const officeId = uuid();
    const userId = uuid();
    const observer = await connect(officeId, uuid(), "Testigo");
    const joined = nextEvent(observer.socket, "player.joined");
    const firstTab = await connect(officeId, userId, "Doble");
    await joined;

    const replaced = new Promise<number>((resolve) => {
      firstTab.socket.addEventListener("close", (event) => resolve(event.code));
    });
    const secondTab = await connect(officeId, userId, "Doble");
    expect(secondTab.snapshot.players).toHaveLength(2);
    await expect(replaced).resolves.toBe(4001);

    await evictDurableObject(
      bindings.OFFICE_ROOM.get(bindings.OFFICE_ROOM.idFromName(officeId)),
    );
    await sleep(50);

    const spawn = spawnPixel(spawnFor(OFFICE_MAP, 1));
    const updated = nextEvent(observer.socket, "player.updated");
    move(secondTab.socket, 5, spawn.x + 10, spawn.y);
    expect((await updated).player.displayName).toBe("Doble");

    const left = nextEvent(observer.socket, "player.left");
    secondTab.socket.close(1000, "bye");
    expect((await left).userId).toBe(userId);
  });

  it("delivers a seven player snapshot to the seventh user", async () => {
    const officeId = uuid();
    for (let index = 0; index < 6; index += 1) {
      await connect(officeId, uuid(), `Amiga ${index + 1}`);
    }
    const seventh = await connect(officeId, uuid(), "Amiga 7");
    expect(seventh.snapshot.players).toHaveLength(7);
  });
});
