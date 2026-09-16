import {
  HEARTBEAT_INTERVAL_MS,
  REALTIME_TICKET_TTL_MS,
  ServerEventSchema,
  type ServerEvent,
} from "@virtual-office/shared";

interface PresenceOptions {
  officeSlug: string;
  onSocket: (socket: WebSocket | null) => void;
  onOpen: () => void;
  onEvent: (event: ServerEvent) => void;
  onDisconnect: () => void;
  onStatus: (status: string) => void;
}

interface Ticket {
  ticket: string;
  url: string;
  localDeadline: number;
}
class AccessDenied extends Error {}

// One connection generation owns its request, timers and socket. A late response
// cannot resurrect a disposed game or refresh a replacement socket.
export function startPresenceConnection(options: PresenceOptions): () => void {
  let disposed = false;
  let paused = false;
  let socket: WebSocket | null = null;
  let request: AbortController | null = null;
  let retryDelay = 1_000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  function clearConnection() {
    clearTimeout(refresh);
    clearTimeout(deadline);
    clearInterval(heartbeat);
    request?.abort();
    request = null;
    const previous = socket;
    socket = null;
    options.onSocket(null);
    options.onDisconnect();
    previous?.close(1000, "presence ended");
  }

  function scheduleRetry() {
    if (disposed || paused || retry) return;
    options.onStatus("Reconectando…");
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  }

  function fail(error: unknown) {
    if (disposed) return;
    if (error instanceof AccessDenied) paused = true;
    clearConnection();
    if (paused) options.onStatus("Acceso finalizado. Vuelve a iniciar sesión.");
    else scheduleRetry();
  }

  async function ticket(): Promise<Ticket> {
    const started = performance.now();
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/realtime-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officeSlug: options.officeSlug }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403)
        throw new AccessDenied();
      if (!response.ok) throw new Error(`ticket ${response.status}`);
      const payload = (await response.json()) as {
        ticket?: string;
        url?: string;
        issuedAt?: number;
        expiresAt?: number;
      };
      if (
        typeof payload.ticket !== "string" ||
        typeof payload.url !== "string" ||
        typeof payload.expiresAt !== "number" ||
        !Number.isFinite(payload.expiresAt) ||
        typeof payload.issuedAt !== "number" ||
        !Number.isFinite(payload.issuedAt)
      ) {
        throw new Error("Invalid presence ticket");
      }
      // Browser and server clocks need not agree. Subtract the full round trip
      // from the ticket lifetime; the Worker remains the expiry authority.
      const lifetime = Math.min(
        REALTIME_TICKET_TTL_MS,
        payload.expiresAt - payload.issuedAt,
      );
      const remaining = lifetime - (performance.now() - started);
      if (remaining <= 0) throw new Error("Presence ticket expired in transit");
      return {
        ticket: payload.ticket,
        url: payload.url,
        localDeadline: performance.now() + remaining,
      };
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }

  function armLease(ws: WebSocket, localDeadline: number) {
    clearTimeout(deadline);
    clearTimeout(refresh);
    deadline = setTimeout(
      () => {
        if (socket === ws) fail(new Error("Presence lease expired"));
      },
      Math.max(0, localDeadline - performance.now()),
    );
    refresh = setTimeout(
      async () => {
        try {
          const next = await ticket();
          if (disposed || socket !== ws || ws.readyState !== WebSocket.OPEN)
            return;
          ws.send(
            JSON.stringify({ type: "session.refresh", ticket: next.ticket }),
          );
          armLease(ws, next.localDeadline);
        } catch (error) {
          if (!disposed && socket === ws) fail(error);
        }
      },
      Math.min(60_000, Math.max(0, localDeadline - performance.now() - 15_000)),
    );
  }

  async function connect() {
    if (disposed || paused || socket) return;
    options.onStatus("Conectando…");
    try {
      const access = await ticket();
      if (disposed || paused) return;
      const url = new URL(access.url);
      url.searchParams.set("ticket", access.ticket);
      const ws = new WebSocket(url.toString());
      socket = ws;
      options.onSocket(ws);
      armLease(ws, access.localDeadline);
      ws.onopen = () => {
        if (socket !== ws || disposed) return;
        retryDelay = 1_000;
        options.onOpen();
        heartbeat = setInterval(() => {
          if (socket === ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      ws.onmessage = (message) => {
        if (socket !== ws || disposed || typeof message.data !== "string")
          return;
        try {
          const result = ServerEventSchema.safeParse(JSON.parse(message.data));
          if (result.success) options.onEvent(result.data);
        } catch {
          /* Discard malformed network frames. */
        }
      };
      ws.onclose = (event) => {
        if (socket !== ws || disposed) return;
        if (event.code === 4001) paused = true;
        clearConnection();
        if (paused)
          options.onStatus(
            "Sesión abierta en otra pestaña. Recarga para volver.",
          );
        else scheduleRetry();
      };
    } catch (error) {
      fail(error);
    }
  }

  void connect();
  return () => {
    disposed = true;
    clearTimeout(retry);
    clearConnection();
  };
}
