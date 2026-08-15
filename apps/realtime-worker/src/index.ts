interface Env {
  APP_ENV: "development" | "staging" | "production";
}

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

export function handleRequest(request: Request, env: Env): Response {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return withSecurityHeaders(
      Response.json({
        ok: true,
        service: "realtime-worker",
        sprint: 1,
        environment: env.APP_ENV,
        capabilities: [],
      }),
    );
  }

  return withSecurityHeaders(
    Response.json({ error: "NOT_FOUND" }, { status: 404 }),
  );
}

export default {
  fetch(request, env): Response {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
