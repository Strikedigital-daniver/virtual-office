const MAX_JSON_BYTES = 64 * 1_024;

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://rtc.live.cloudflare.com wss:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(self), display-capture=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
    },
  });
}

export function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_JSON_BYTES) throw new Error("Request body is too large");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new Error("Request body is too large");
  return text.length === 0 ? {} : (JSON.parse(text) as unknown);
}

export function isAllowedOrigin(request: Request, allowedOrigin: string): boolean {
  const origin = request.headers.get("Origin");
  return origin === null || origin === allowedOrigin;
}

export function withSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

