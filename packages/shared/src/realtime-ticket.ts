import { z } from "zod";

import { REALTIME_TICKET_TTL_MS } from "./protocol";

export const RealtimeTicketClaimsSchema = z.object({
  version: z.literal(1),
  userId: z.string().uuid(),
  officeId: z.string().uuid(),
  displayName: z.string().min(1).max(40),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});
export type RealtimeTicketClaims = z.infer<typeof RealtimeTicketClaimsSchema>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  if (secret.length < 32) {
    throw new Error("The ticket signing secret must be at least 32 characters");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueRealtimeTicket(
  input: { userId: string; officeId: string; displayName: string },
  secret: string,
  now = Date.now(),
): Promise<string> {
  const claims: RealtimeTicketClaims = {
    version: 1,
    userId: input.userId,
    officeId: input.officeId,
    displayName: input.displayName,
    issuedAt: now,
    expiresAt: now + REALTIME_TICKET_TTL_MS,
  };
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyRealtimeTicket(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<RealtimeTicketClaims> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Malformed ticket");

  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    base64UrlToBytes(signature),
    encoder.encode(payload),
  );
  if (!valid) throw new Error("Invalid ticket signature");

  const claims = RealtimeTicketClaimsSchema.parse(
    JSON.parse(decoder.decode(base64UrlToBytes(payload))) as unknown,
  );
  if (claims.expiresAt <= now) throw new Error("Ticket expired");
  if (claims.issuedAt > now + 30_000) {
    throw new Error("Ticket issued in the future");
  }
  return claims;
}
