import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";

describe("realtime worker foundation", () => {
  it("reports its Sprint 1 boundary without enabling map or media capabilities", async () => {
    const response = handleRequest(new Request("https://worker.test/health"), {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "realtime-worker",
      sprint: 1,
      environment: "development",
      capabilities: [],
    });
  });

  it("returns a closed 404 surface for unimplemented routes", async () => {
    const response = handleRequest(new Request("https://worker.test/ws"), {
      APP_ENV: "development",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });
});
