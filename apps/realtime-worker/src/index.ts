import type { Env } from "./env";
import { OfficeRoom } from "./office-room";

export { OfficeRoom };
export type { Env };

const OFFICE_PATH = /^\/office\/([0-9a-f-]{36})\/(connect|media\/.+)$/u;

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return withSecurityHeaders(
      Response.json({
        ok: true,
        service: "realtime-worker",
        sprint: 3,
        environment: env.APP_ENV,
        capabilities: ["presence", "media"],
      }),
    );
  }

  const match = OFFICE_PATH.exec(url.pathname);
  if (match) {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGIN;
    if (allowed && origin && origin !== allowed) {
      return withSecurityHeaders(
        Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 }),
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowed ?? origin ?? "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        },
      });
    }

    const officeId = match[1]!;
    const stub = env.OFFICE_ROOM.get(env.OFFICE_ROOM.idFromName(officeId));
    const response = await stub.fetch(request);
    if (response.status === 101) return response;
    return withCors(response, allowed ?? origin ?? "*");
  }

  return withSecurityHeaders(
    Response.json({ error: "NOT_FOUND" }, { status: 404 }),
  );
}

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
