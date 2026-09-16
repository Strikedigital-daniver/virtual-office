import { env, exports } from "cloudflare:workers";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueRealtimeTicket,
  OFFICE_MAP,
  REALTIME_TICKET_TTL_MS,
  TILE_SIZE,
  zoneAtPixel,
  type SpatialAccessClass,
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

function eventOf(
  socket: WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Missing ${type}`)),
      2_000,
    );
    const handler = (event: MessageEvent) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (value.type !== type) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handler);
      resolve(value);
    };
    socket.addEventListener("message", handler);
  });
}

async function connect(
  officeId: string,
  userId = crypto.randomUUID(),
  accessClass: SpatialAccessClass = "RECUERDA_STAFF",
) {
  const ticket = await issueRealtimeTicket(
    { userId, officeId, displayName: "Tester", accessClass },
    SECRET,
  );
  const response = await worker.fetch(
    `${ORIGIN}/office/${officeId}/connect?ticket=${ticket}`,
    {
      headers: { Upgrade: "websocket", Origin: ORIGIN },
    },
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  sockets.push(socket);
  await eventOf(socket, "office.snapshot");
  return { socket, ticket, userId };
}

function stubFor(officeId: string) {
  return bindings.OFFICE_ROOM.get(bindings.OFFICE_ROOM.idFromName(officeId));
}

function zonePoint(zoneId: string) {
  const zone = OFFICE_MAP.zones.find(
    (candidate) => candidate.zoneId === zoneId,
  )!;
  return { x: (zone.x + 1.5) * TILE_SIZE, y: (zone.y + 1.5) * TILE_SIZE };
}

type Attachment = {
  userId: string;
  connectionId: string;
  authorizedUntil: number;
  [key: string]: unknown;
};
function attachment(socket: WebSocket) {
  return socket.deserializeAttachment() as Attachment;
}

async function prepareSubscription() {
  const officeId = crypto.randomUUID();
  const listener = await connect(officeId);
  const publisher = await connect(officeId);
  const stub = stubFor(officeId);
  const calls: Array<{ path: string; body: unknown }> = [];
  await runInDurableObject(stub, async (instance, state) => {
    for (const socket of state.getWebSockets()) {
      const current = attachment(socket);
      const point = zonePoint("zone-meeting");
      socket.serializeAttachment({
        ...current,
        ...point,
        zoneId: zoneAtPixel(OFFICE_MAP, point.x, point.y),
      });
      if (current.userId === listener.userId) {
        await state.storage.put("media-session:listener-session", {
          userId: listener.userId,
          connectionId: current.connectionId,
          sessionId: "listener-session",
          createdAt: Date.now(),
        });
      }
    }
    await state.storage.put("published-track:publisher-session:mic", {
      storageVersion: 1,
      ownerUserId: publisher.userId,
      sessionId: "publisher-session",
      trackName: "mic",
      mid: "send-0",
      kind: "audio",
    });
    const internals = instance as unknown as {
      callRealtime: (
        path: string,
        method: string,
        body?: unknown,
      ) => Promise<{ response: Response; json: unknown }>;
    };
    internals.callRealtime = async (path, _method, body) => {
      calls.push({ path, body });
      const json = path.endsWith("/tracks/new")
        ? {
            tracks: [
              {
                sessionId: "publisher-session",
                trackName: "mic",
                mid: "recv-0",
              },
            ],
          }
        : { tracks: [{ mid: "recv-0" }] };
      return { response: Response.json(json), json };
    };
  });
  const subscribe = () =>
    worker.fetch(`${ORIGIN}/office/${officeId}/media/tracks/subscribe`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${listener.ticket}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "listener-session",
        tracks: [
          {
            location: "remote",
            sessionId: "publisher-session",
            trackName: "mic",
          },
        ],
      }),
    });
  return { officeId, listener, publisher, stub, calls, subscribe };
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000, "test cleanup");
  vi.restoreAllMocks();
});

describe("spatial authorization lease", () => {
  it("expires idle sockets after hibernation, clears media ownership and emits leave", async () => {
    const officeId = crypto.randomUUID();
    const observer = await connect(officeId);
    const expired = await connect(officeId);
    const stub = stubFor(officeId);
    await runInDurableObject(stub, async (_instance, state) => {
      const socket = state
        .getWebSockets()
        .find((candidate) => attachment(candidate).userId === expired.userId)!;
      socket.serializeAttachment({
        ...attachment(socket),
        authorizedUntil: Date.now() - 1,
      });
      await state.storage.put("media-session:expired-session", {
        userId: expired.userId,
      });
    });
    await evictDurableObject(stub);
    const closed = new Promise<number>((resolve) =>
      expired.socket.addEventListener("close", (event) => resolve(event.code)),
    );
    const left = eventOf(observer.socket, "player.left");
    await runDurableObjectAlarm(stub);
    expect(await closed).toBe(4003);
    expect((await left).userId).toBe(expired.userId);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        await state.storage.get("media-session:expired-session"),
      ).toBeUndefined();
    });
  });

  it("renews with a fresh ticket but rejects a ticket for another world", async () => {
    const officeId = crypto.randomUUID();
    const client = await connect(officeId);
    const stub = stubFor(officeId);
    await runInDurableObject(stub, (_instance, state) => {
      const socket = state.getWebSockets()[0]!;
      socket.serializeAttachment({
        ...attachment(socket),
        authorizedUntil: Date.now() + 10_000,
      });
    });
    const now = Date.now();
    const renewed = await issueRealtimeTicket(
      {
        userId: client.userId,
        officeId,
        displayName: "Tester",
        accessClass: "RECUERDA_STAFF",
      },
      SECRET,
      now,
    );
    const pong = eventOf(client.socket, "pong");
    client.socket.send(
      JSON.stringify({ type: "session.refresh", ticket: renewed }),
    );
    client.socket.send(JSON.stringify({ type: "ping", clientTime: now }));
    await pong;
    await runInDurableObject(stub, (_instance, state) => {
      expect(attachment(state.getWebSockets()[0]!).authorizedUntil).toBe(
        now + REALTIME_TICKET_TTL_MS,
      );
    });
    const foreign = await issueRealtimeTicket(
      {
        userId: client.userId,
        officeId: crypto.randomUUID(),
        displayName: "Tester",
        accessClass: "RECUERDA_STAFF",
      },
      SECRET,
    );
    const closed = new Promise<number>((resolve) =>
      client.socket.addEventListener("close", (event) => resolve(event.code)),
    );
    client.socket.send(
      JSON.stringify({ type: "session.refresh", ticket: foreign }),
    );
    expect(await closed).toBe(4003);
  });

  it("does not create an SFU session without active presence", async () => {
    const officeId = crypto.randomUUID();
    const ticket = await issueRealtimeTicket(
      {
        userId: crypto.randomUUID(),
        officeId,
        displayName: "Detached",
        accessClass: "CLUB_MEMBER",
      },
      SECRET,
    );
    const response = await worker.fetch(
      `${ORIGIN}/office/${officeId}/media/session`,
      {
        method: "POST",
        headers: { Origin: ORIGIN, Authorization: `Bearer ${ticket}` },
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "PRESENCE_REQUIRED" });
  });
});

describe("server-side subscription revocation", () => {
  it("retains subscription tracking when the SFU reports a per-track close error", async () => {
    const fixture = await prepareSubscription();
    await fixture.subscribe();
    await runInDurableObject(fixture.stub, (instance) => {
      const internals = instance as unknown as {
        callRealtime: (
          path: string,
        ) => Promise<{ response: Response; json: unknown }>;
      };
      internals.callRealtime = async () => {
        const json = {
          tracks: [{ mid: "recv-0", errorCode: "retryable_error" }],
        };
        return { response: Response.json(json), json };
      };
    });
    const response = await worker.fetch(
      `${ORIGIN}/office/${fixture.officeId}/media/tracks/close`,
      {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${fixture.listener.ticket}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: "listener-session",
          tracks: [{ mid: "recv-0" }],
          force: true,
        }),
      },
    );
    expect(response.status).toBe(200);
    await runInDurableObject(fixture.stub, async (_instance, state) => {
      expect(
        (await state.storage.list({ prefix: "media-subscription:" })).size,
      ).toBe(1);
    });
  });

  it("closes a malicious listener's existing SFU pull after room access changes", async () => {
    const fixture = await prepareSubscription();
    expect((await fixture.subscribe()).status).toBe(200);
    await runInDurableObject(fixture.stub, async (instance, state) => {
      const listenerSocket = state
        .getWebSockets()
        .find(
          (socket) => attachment(socket).userId === fixture.listener.userId,
        )!;
      const point = zonePoint("zone-commons");
      listenerSocket.serializeAttachment({
        ...attachment(listenerSocket),
        ...point,
        zoneId: zoneAtPixel(OFFICE_MAP, point.x, point.y),
      });
      await (
        instance as unknown as {
          webSocketMessage(socket: WebSocket, event: string): Promise<void>;
        }
      ).webSocketMessage(
        listenerSocket,
        JSON.stringify({
          type: "player.move",
          seq: 1,
          ...point,
          direction: "down",
          moving: false,
          clientTime: Date.now(),
        }),
      );
      expect(
        (await state.storage.list({ prefix: "media-subscription:" })).size,
      ).toBe(0);
    });
    expect(fixture.calls.at(-1)).toEqual({
      path: "/sessions/listener-session/tracks/close",
      body: { tracks: [{ mid: "recv-0" }], force: true },
    });
  });

  it("revokes a pull when presence changes while the SFU request is in flight", async () => {
    const fixture = await prepareSubscription();
    await runInDurableObject(fixture.stub, (instance, state) => {
      const internals = instance as unknown as {
        callRealtime: (
          path: string,
          method: string,
          body?: unknown,
        ) => Promise<{ response: Response; json: unknown }>;
      };
      const original = internals.callRealtime;
      internals.callRealtime = async (path, method, body) => {
        const result = await original(path, method, body);
        if (path.endsWith("/tracks/new")) {
          const listenerSocket = state
            .getWebSockets()
            .find(
              (socket) => attachment(socket).userId === fixture.listener.userId,
            )!;
          const point = zonePoint("zone-commons");
          listenerSocket.serializeAttachment({
            ...attachment(listenerSocket),
            ...point,
            zoneId: zoneAtPixel(OFFICE_MAP, point.x, point.y),
          });
        }
        return result;
      };
    });
    await fixture.subscribe();
    expect(fixture.calls.at(-1)?.path).toBe(
      "/sessions/listener-session/tracks/close",
    );
  });

  it("keeps a failed revocation durable and retries it without client cooperation", async () => {
    const fixture = await prepareSubscription();
    await fixture.subscribe();
    await runInDurableObject(fixture.stub, async (instance, state) => {
      const internals = instance as unknown as {
        callRealtime: () => Promise<{ response: Response; json: unknown }>;
        alarm(): Promise<void>;
      };
      const original = internals.callRealtime;
      internals.callRealtime = async () => ({
        response: Response.json({}, { status: 503 }),
        json: {},
      });
      const listenerSocket = state
        .getWebSockets()
        .find(
          (socket) => attachment(socket).userId === fixture.listener.userId,
        )!;
      const point = zonePoint("zone-commons");
      listenerSocket.serializeAttachment({
        ...attachment(listenerSocket),
        ...point,
      });
      await internals.alarm();
      expect(
        (await state.storage.list({ prefix: "media-subscription:" })).size,
      ).toBe(1);
      expect(await state.storage.getAlarm()).toBeLessThanOrEqual(
        Date.now() + 1_000,
      );
      internals.callRealtime = original;
      await internals.alarm();
      expect(
        (await state.storage.list({ prefix: "media-subscription:" })).size,
      ).toBe(0);
    });
  });
});
