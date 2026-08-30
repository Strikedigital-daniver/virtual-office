import type { Env } from "./env";
import { OfficeRoom } from "./office-room";

export { OfficeRoom };
export type { Env };

const OFFICE_PATH = /^\/office\/([0-9a-f-]{36})\/connect$/u;

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
        sprint: 2,
        environment: env.APP_ENV,
        capabilities: ["presence"],
      }),
    );
  }

  const match = OFFICE_PATH.exec(url.pathname);
  if (match) {
    const origin = request.headers.get("Origin");
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return withSecurityHeaders(
        Response.json({ error: "ORIGIN_NOT_ALLOWED" }, { status: 403 }),
      );
    }
    const officeId = match[1]!;
    const stub = env.OFFICE_ROOM.get(env.OFFICE_ROOM.idFromName(officeId));
    return stub.fetch(request);
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
