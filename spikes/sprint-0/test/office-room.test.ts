import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerEvent } from "../src/shared/protocol";
import type { Env as WorkerEnv } from "../src/worker/env";

const worker = (
  exports as unknown as {
    default: {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  }
).default;
const bindings = env as unknown as WorkerEnv;

interface ConnectedClient {
  clientId: string;
  token: string;
  socket: WebSocket;
  snapshot: Extract<ServerEvent, { type: "office.snapshot" }>;
}

const sockets: WebSocket[] = [];

async function nextEvent<T extends ServerEvent["type"]>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 3_000);
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

async function ticketFor(displayName: string, roomId: string) {
  const response = await worker.fetch("https://spike.test/api/spike/ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://spike.test" },
    body: JSON.stringify({ displayName, roomId }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { token: string; clientId: string };
}

async function connect(token: string, clientId: string): Promise<ConnectedClient> {
  const response = await worker.fetch(
    `https://spike.test/ws?ticket=${encodeURIComponent(token)}`,
    { headers: { Upgrade: "websocket", Origin: "https://spike.test" } },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("Worker did not return a WebSocket");
  socket.accept();
  sockets.push(socket);
  const snapshot = await nextEvent(socket, "office.snapshot");
  return { token, clientId, socket, snapshot };
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000, "test cleanup");
});

describe("OfficeRoom Hibernation WebSockets", () => {
  it("synchronizes two squares, survives eviction, and replaces a reconnecting client", async () => {
    const roomId = `room-${crypto.randomUUID()}`;
    const firstTicket = await ticketFor("Primero", roomId);
    const first = await connect(firstTicket.token, firstTicket.clientId);
    expect(first.snapshot.players).toHaveLength(1);

    const joined = nextEvent(first.socket, "player.joined");
    const secondTicket = await ticketFor("Segundo", roomId);
    const second = await connect(secondTicket.token, secondTicket.clientId);
    expect(second.snapshot.players).toHaveLength(2);
    expect((await joined).player.clientId).toBe(second.clientId);

    const beforeEviction = nextEvent(second.socket, "player.updated");
    first.socket.send(
      JSON.stringify({ type: "player.move", seq: 1, x: 144, y: 96, clientTime: Date.now() }),
    );
    expect((await beforeEviction).player).toMatchObject({ clientId: first.clientId, x: 144, y: 96 });

    const id = bindings.OFFICE_ROOMS.idFromName(roomId);
    await evictDurableObject(bindings.OFFICE_ROOMS.get(id));

    const afterEviction = nextEvent(second.socket, "player.updated");
    first.socket.send(
      JSON.stringify({ type: "player.move", seq: 2, x: 216, y: 120, clientTime: Date.now() }),
    );
    expect((await afterEviction).player).toMatchObject({ clientId: first.clientId, x: 216, y: 120 });

    const reconnected = await connect(first.token, first.clientId);
    expect(reconnected.snapshot.players).toHaveLength(2);
    expect(reconnected.snapshot.players.find((player) => player.clientId === first.clientId)).toMatchObject({
      x: 216,
      y: 120,
      lastSeq: 2,
    });
  });
});
