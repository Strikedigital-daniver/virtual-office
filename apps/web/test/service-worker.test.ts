import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function setup() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const cache = { match: vi.fn(), put: vi.fn(), add: vi.fn() };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(),
    keys: vi.fn(async () => [
      "virtual-office-shell-old",
      "virtual-office-shell-v1",
      "another-app",
    ]),
    delete: vi.fn(),
  };
  const fetch = vi.fn();
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://office.test" },
      addEventListener: (
        name: string,
        fn: (event: Record<string, unknown>) => void,
      ) => listeners.set(name, fn),
      clients: { claim: vi.fn() },
    },
    caches,
    fetch,
    URL,
    Response,
  });
  return { listeners, cache, caches, fetch };
}
describe("PWA cache boundaries", () => {
  it("cleans only this application's obsolete caches", async () => {
    const { listeners, caches } = setup();
    let work: Promise<unknown> | undefined;
    listeners.get("activate")!({
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    await work;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith(
      "virtual-office-shell-old",
    );
  });
  it("never stores authenticated navigation and supplies a response when the offline cache is missing", async () => {
    const { listeners, fetch, cache } = setup();
    fetch.mockRejectedValue(new Error("offline"));
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request: {
        method: "GET",
        mode: "navigate",
        url: "https://office.test/office/temple",
      },
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    const result = await response;
    expect(result?.status).toBe(503);
    expect(cache.put).not.toHaveBeenCalled();
  });
  it("does not intercept API requests or other origins", () => {
    const { listeners, caches } = setup();
    const respondWith = vi.fn();
    for (const url of [
      "https://office.test/api/realtime-ticket",
      "https://other.test/_next/static/file.js",
    ]) {
      listeners.get("fetch")!({
        request: { method: "GET", mode: "cors", url },
        respondWith,
      });
    }
    expect(respondWith).not.toHaveBeenCalled();
    expect(caches.open).not.toHaveBeenCalled();
  });
});
