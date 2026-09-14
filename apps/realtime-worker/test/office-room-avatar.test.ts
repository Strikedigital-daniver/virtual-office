import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_AVATAR_APPEARANCE,
  issueRealtimeTicket,
  spawnFor,
  spawnPixel,
  OFFICE_MAP,
  type ServerEvent,
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
    { userId, officeId, displayName, accessClass: "CLUB_MEMBER" },
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
  return { socket, snapshot, userId };
}

function setAvatar(socket: WebSocket, appearance = DEFAULT_AVATAR_APPEARANCE) {
  socket.send(
    JSON.stringify({
      type: "player.avatar.set",
      appearance,
      clientTime: Date.now(),
    }),
  );
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000, "test cleanup");
});

describe("Sprint 7.2 avatar realtime", () => {
  it("W/X: join snapshot can carry validated appearance after set", async () => {
    const officeId = crypto.randomUUID();
    const first = await connect(officeId, crypto.randomUUID(), "Ada");
    const updated = nextEvent(first.socket, "player.avatar.updated");
    setAvatar(first.socket);
    await updated;

    const second = await connect(officeId, crypto.randomUUID(), "Bea");
    const remote = second.snapshot.players.find(
      (player) => player.userId === first.userId,
    );
    expect(remote?.appearance).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });

  it("Y/AA: saving appearance emits player.avatar.updated once", async () => {
    const officeId = crypto.randomUUID();
    const first = await connect(officeId, crypto.randomUUID(), "Ada");
    const second = await connect(officeId, crypto.randomUUID(), "Bea");
    const seen: ServerEvent[] = [];
    second.socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      seen.push(JSON.parse(event.data) as ServerEvent);
    });
    const updated = nextEvent(second.socket, "player.avatar.updated");
    setAvatar(first.socket);
    const event = await updated;
    expect(event.userId).toBe(first.userId);
    expect(event.appearance).toEqual(DEFAULT_AVATAR_APPEARANCE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      seen.filter((item) => item.type === "player.avatar.updated"),
    ).toHaveLength(1);
  });

  it("Z: movement events omit unchanged appearance", async () => {
    const officeId = crypto.randomUUID();
    const first = await connect(officeId, crypto.randomUUID(), "Ada");
    const updated = nextEvent(first.socket, "player.avatar.updated");
    setAvatar(first.socket);
    await updated;
    const second = await connect(officeId, crypto.randomUUID(), "Bea");
    const spawn = spawnPixel(spawnFor(OFFICE_MAP, 0));
    const moved = nextEvent(second.socket, "player.updated");
    first.socket.send(
      JSON.stringify({
        type: "player.move",
        seq: 1,
        x: spawn.x + 12,
        y: spawn.y,
        direction: "right",
        moving: true,
        clientTime: Date.now(),
      }),
    );
    const event = await moved;
    expect(event.player.appearance).toBeUndefined();
  });
});
