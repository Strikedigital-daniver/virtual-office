import { TicketRequestSchema } from "../shared/protocol";
import type { Env } from "./env";
import {
  errorResponse,
  isAllowedOrigin,
  jsonResponse,
  readJson,
  withSecurityHeaders,
} from "./http";
import { OfficeRoom } from "./office-room";
import { issueTicket, verifyTicket } from "./ticket";

export { OfficeRoom };

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

async function authenticate(request: Request, env: Env) {
  const token = bearerToken(request);
  if (!token) throw new Error("Missing bearer ticket");
  return verifyTicket(token, env.SPIKE_SESSION_SIGNING_SECRET);
}

async function proxyToRoom(request: Request, env: Env, internalPath: string): Promise<Response> {
  const claims = await authenticate(request, env);
  const roomId = env.OFFICE_ROOMS.idFromName(claims.roomId);
  const stub = env.OFFICE_ROOMS.get(roomId);
  const headers = new Headers(request.headers);
  headers.set("X-Spike-Client-Id", claims.clientId);
  headers.set("X-Spike-Display-Name", claims.displayName);
  headers.delete("Authorization");
  headers.delete("Origin");

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }
  return stub.fetch(
    new Request(`https://office-room.internal${internalPath}`, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
    }),
  );
}

async function handleTurnCredentials(request: Request, env: Env): Promise<Response> {
  await authenticate(request, env);
  if (!env.CLOUDFLARE_TURN_KEY_ID || !env.CLOUDFLARE_TURN_KEY_API_TOKEN) {
    return errorResponse(
      501,
      "TURN_NOT_CONFIGURED",
      "TURN diagnostics require a server-side TURN key ID and API token.",
    );
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 3_600 }),
    },
  );
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      sprint: 0,
      realtimeConfigured: Boolean(
        env.CLOUDFLARE_REALTIME_APP_ID && env.CLOUDFLARE_REALTIME_APP_SECRET,
      ),
      turnDiagnosticConfigured: Boolean(
        env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_KEY_API_TOKEN,
      ),
    });
  }

  if (!isAllowedOrigin(request, env.ALLOWED_ORIGIN)) {
    return errorResponse(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed.");
  }

  if (url.pathname === "/api/spike/ticket" && request.method === "POST") {
    const input = TicketRequestSchema.parse(await readJson(request));
    const { token, claims } = await issueTicket(input, env.SPIKE_SESSION_SIGNING_SECRET);
    return jsonResponse({ token, clientId: claims.clientId, expiresAt: claims.expiresAt });
  }

  if (url.pathname === "/ws" && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const token = url.searchParams.get("ticket");
    if (!token) return errorResponse(401, "TICKET_REQUIRED", "A short-lived ticket is required.");
    const claims = await verifyTicket(token, env.SPIKE_SESSION_SIGNING_SECRET);
    const roomId = env.OFFICE_ROOMS.idFromName(claims.roomId);
    const headers = new Headers(request.headers);
    headers.set("X-Spike-Client-Id", claims.clientId);
    headers.set("X-Spike-Display-Name", claims.displayName);
    const stub = env.OFFICE_ROOMS.get(roomId);
    return stub.fetch(new Request("https://office-room.internal/connect", { headers }));
  }

  const mediaRoutes = new Map<string, string>([
    ["/api/media/session", "/media/session"],
    ["/api/media/tracks/publish", "/media/tracks/publish"],
    ["/api/media/tracks/subscribe", "/media/tracks/subscribe"],
    ["/api/media/renegotiate", "/media/renegotiate"],
    ["/api/media/tracks/close", "/media/tracks/close"],
  ]);
  const internalMediaPath = mediaRoutes.get(url.pathname);
  if (internalMediaPath && request.method === "POST") {
    return proxyToRoom(request, env, internalMediaPath);
  }

  if (url.pathname === "/api/turn/credentials" && request.method === "POST") {
    return handleTurnCredentials(request, env);
  }

  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
    return errorResponse(404, "NOT_FOUND", "Endpoint not found.");
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return withSecurityHeaders(await handle(request, env));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      const clientError =
        message.includes("ticket") ||
        message.includes("Ticket") ||
        message.includes("Request body") ||
        message.includes("JSON");
      return errorResponse(clientError ? 400 : 500, clientError ? "INVALID_REQUEST" : "INTERNAL_ERROR", message);
    }
  },
} satisfies ExportedHandler<Env>;

