import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startPresenceConnection } from "@/lib/game/presence-connection";

class FakeSocket {
  static OPEN = 1;
  static sockets: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  });
  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
const request = vi.fn();
let dispose: (() => void) | undefined;
let disconnect = vi.fn<() => void>();
let status = vi.fn<(value: string) => void>();
function access() {
  return Response.json({
    ticket: "test-ticket",
    url: "wss://presence.example.test/office/connect",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 120_000,
  });
}
function start() {
  dispose = startPresenceConnection({
    officeSlug: "temple",
    onSocket: vi.fn(),
    onOpen: vi.fn(),
    onEvent: vi.fn(),
    onDisconnect: disconnect,
    onStatus: status,
  });
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "performance",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
  });
  FakeSocket.sockets = [];
  request.mockReset().mockImplementation(async () => access());
  disconnect = vi.fn();
  status = vi.fn();
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("renews the lease every minute without opening another socket", async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);
  const socket = FakeSocket.sockets[0]!;
  socket.open();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "session.refresh", ticket: "test-ticket" }),
  );
  expect(FakeSocket.sockets).toHaveLength(1);
  expect(disconnect).not.toHaveBeenCalled();
});
it.each([-300_000, 300_000])(
  "renews with browser/server clock skew of %i ms",
  async (skew) => {
    request.mockImplementation(async () =>
      Response.json({
        ticket: "skewed-ticket",
        url: "wss://presence.example.test/connect",
        issuedAt: Date.now() + skew,
        expiresAt: Date.now() + skew + 120_000,
      }),
    );
    start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeSocket.sockets[0]!;
    expect(socket).toBeDefined();
    socket.open();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "session.refresh", ticket: "skewed-ticket" }),
    );
    expect(disconnect).not.toHaveBeenCalled();
  },
);
it("ends media/presence and stops retrying on denied renewal", async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);
  const socket = FakeSocket.sockets[0]!;
  socket.open();
  request.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await vi.advanceTimersByTimeAsync(180_000);
  expect(socket.close).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(2);
  expect(status).toHaveBeenLastCalledWith(
    "Acceso finalizado. Vuelve a iniciar sesión.",
  );
});
it("does not create reconnect ping-pong when another tab replaces this session", async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);
  FakeSocket.sockets[0]!.onclose?.({ code: 4001 });
  await vi.advanceTimersByTimeAsync(180_000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledOnce();
});
it("reconnects for fresh access class and ignores messages from the old socket", async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);
  const old = FakeSocket.sockets[0]!;
  old.onclose?.({ code: 4003 });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.sockets).toHaveLength(2);
  old.onclose?.({ code: 4001 });
  expect(disconnect).toHaveBeenCalledOnce();
});
it("aborts ticket loading on disposal and ignores a late response", async () => {
  let resolve!: (value: Response) => void;
  request.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  start();
  const signal = request.mock.calls[0]![1].signal as AbortSignal;
  dispose!();
  expect(signal.aborted).toBe(true);
  resolve(access());
  await vi.advanceTimersByTimeAsync(180_000);
  expect(FakeSocket.sockets).toHaveLength(0);
  expect(request).toHaveBeenCalledTimes(1);
});
it("disconnects at the lease deadline even if renewal ignores abort", async () => {
  start();
  await vi.advanceTimersByTimeAsync(0);
  const socket = FakeSocket.sockets[0]!;
  socket.open();
  request.mockImplementationOnce(() => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(socket.close).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});
