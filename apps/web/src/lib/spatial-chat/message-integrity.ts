import { z } from "zod";

export class ChatMessageConflictError extends Error {
  constructor() {
    super("El identificador del mensaje ya se utilizó para otro envío.");
    this.name = "ChatMessageConflictError";
  }
}

/** A retry must describe the same operation, never a different audience. */
export function assertSameMessageRetry(
  existing: { channelId: string; body: string; deletedAt?: string | null },
  requested: { channelId: string; body: string },
): void {
  if (
    existing.channelId !== requested.channelId ||
    existing.body !== requested.body ||
    existing.deletedAt
  ) {
    throw new ChatMessageConflictError();
  }
}

export const ChatHistoryQuerySchema = z
  .object({
    channelId: z.string().uuid(),
    cursorCreatedAt: z.iso.datetime({ offset: true }).optional(),
    cursorId: z.string().uuid().optional(),
  })
  .refine(
    (value) => Boolean(value.cursorCreatedAt) === Boolean(value.cursorId),
    { message: "Both cursor components are required" },
  );
