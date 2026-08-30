import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";

const worker = (
  exports as unknown as {
    default: {
      fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
  }
).default;
const bindings = env as unknown as Env;

describe("realtime worker surface", () => {
  it("reports the Sprint 2 presence capability", async () => {
    const response = await worker.fetch("https://office.test/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "realtime-worker",
      sprint: 2,
      environment: bindings.APP_ENV,
      capabilities: ["presence"],
    });
  });

  it("returns a closed 404 surface for unknown routes", async () => {
    const response = await worker.fetch("https://office.test/ws");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("rejects an office upgrade from a foreign origin", async () => {
    const response = await worker.fetch(
      "https://office.test/office/11111111-1111-4111-8111-111111111111/connect",
      { headers: { Upgrade: "websocket", Origin: "https://evil.example" } },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "ORIGIN_NOT_ALLOWED",
    });
  });
});
