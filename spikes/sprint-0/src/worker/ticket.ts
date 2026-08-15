import { z } from "zod";
import type { TicketRequest } from "../shared/protocol";

const TicketClaimsSchema = z.object({
  version: z.literal(1),
  clientId: z.string().uuid(),
  roomId: z.string().min(1).max(48),
  displayName: z.string().min(1).max(40),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type TicketClaims = z.infer<typeof TicketClaimsSchema>;

const TICKET_TTL_MS = 15 * 60 * 1_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("SPIKE_SESSION_SIGNING_SECRET must contain at least 32 characters");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueTicket(
  request: TicketRequest,
  secret: string,
  now = Date.now(),
): Promise<{ token: string; claims: TicketClaims }> {
  const claims: TicketClaims = {
    version: 1,
    clientId: crypto.randomUUID(),
    roomId: request.roomId,
    displayName: request.displayName,
    issuedAt: now,
    expiresAt: now + TICKET_TTL_MS,
  };
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload));
  return {
    token: `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`,
    claims,
  };
}

export async function verifyTicket(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<TicketClaims> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("Malformed ticket");

  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    base64UrlToBytes(signature),
    encoder.encode(payload),
  );
  if (!valid) throw new Error("Invalid ticket signature");

  const claims = TicketClaimsSchema.parse(
    JSON.parse(decoder.decode(base64UrlToBytes(payload))) as unknown,
  );
  if (claims.expiresAt <= now) throw new Error("Ticket expired");
  if (claims.issuedAt > now + 30_000) throw new Error("Ticket issued in the future");
  return claims;
}

