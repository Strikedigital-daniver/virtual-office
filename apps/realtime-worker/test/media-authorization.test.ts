import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { issueRealtimeTicket } from "@virtual-office/shared";

const worker = (
  exports as unknown as {
    default: {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  }
).default;
const SECRET = "test-signing-secret-at-least-thirty-two-characters";
const ORIGIN = "https://office.test";

function uuid(): string {
  return crypto.randomUUID();
}

async function mediaCall(
  officeId: string,
  action: string,
  ticket: string | null,
  body?: unknown,
) {
  return worker.fetch(`${ORIGIN}/office/${officeId}/media/${action}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...(ticket ? { Authorization: `Bearer ${ticket}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("media switchboard authorization", () => {
  it("refuses media calls without a ticket", async () => {
    const response = await mediaCall(uuid(), "session", null);
    expect(response.status).toBe(401);
  });

  it("refuses a ticket issued for another office", async () => {
    const officeId = uuid();
    const foreign = await issueRealtimeTicket(
      { userId: uuid(), officeId: uuid(), displayName: "Intruso" },
      SECRET,
    );
    const response = await mediaCall(officeId, "session", foreign);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "TICKET_OFFICE_MISMATCH",
    });
  });

  it("refuses to pull a track that is not registered in the office", async () => {
    const officeId = uuid();
    const ticket = await issueRealtimeTicket(
      { userId: uuid(), officeId, displayName: "Curiosa" },
      SECRET,
    );
    const response = await mediaCall(officeId, "tracks/subscribe", ticket, {
      sessionId: "session-that-is-not-mine",
      tracks: [
        {
          location: "remote",
          sessionId: "someone-else-session",
          trackName: "audio-guessed-name",
        },
      ],
    });

    // Knowing a track name is never enough: the session must belong to the
    // caller before the Worker will even look at the requested track.
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "SESSION_NOT_OWNED",
    });
  });

  it("rejects malformed media payloads", async () => {
    const officeId = uuid();
    const ticket = await issueRealtimeTicket(
      { userId: uuid(), officeId, displayName: "Torpe" },
      SECRET,
    );
    const response = await mediaCall(officeId, "tracks/publish", ticket, {
      sessionId: "s",
      tracks: [],
    });
    expect(response.status).toBe(400);
  });

  it("answers CORS preflight only for the configured origin", async () => {
    const officeId = uuid();
    const allowed = await worker.fetch(
      `${ORIGIN}/office/${officeId}/media/session`,
      { method: "OPTIONS", headers: { Origin: ORIGIN } },
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    const foreign = await worker.fetch(
      `${ORIGIN}/office/${officeId}/media/session`,
      { method: "OPTIONS", headers: { Origin: "https://evil.example" } },
    );
    expect(foreign.status).toBe(403);
  });

  it("degrades safely when Realtime credentials are absent", async () => {
    const officeId = uuid();
    const ticket = await issueRealtimeTicket(
      { userId: uuid(), officeId, displayName: "Sin credenciales" },
      SECRET,
    );
    const response = await mediaCall(officeId, "session", ticket);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "REALTIME_NOT_CONFIGURED",
    });
  });
});
