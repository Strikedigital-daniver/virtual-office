import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiJson } from "../src/client/api";

describe("apiJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves Cloudflare status and errorDescription for session recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errorCode: "SESSION_GONE", errorDescription: "Session expired" }), {
          status: 410,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const request = apiJson("/api/media/tracks/publish", { body: {} });

    await expect(request).rejects.toBeInstanceOf(ApiRequestError);
    await expect(request).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 410,
      message: "Session expired",
    });
  });
});
