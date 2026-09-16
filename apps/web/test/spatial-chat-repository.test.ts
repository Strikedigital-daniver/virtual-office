import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/spatial-chat/ephemeral", () => ({
  isSpatialChatEphemeral: () => false,
}));

import {
  getOrCreateDirectChannel,
  insertChannelMessage,
  listChannelMessages,
} from "@/lib/spatial-chat/repository";
import {
  insertEphemeralChannelMessage,
  listEphemeralChannelMessages,
} from "@/lib/spatial-chat/in-memory-store";
import { ChatMessageConflictError } from "@/lib/spatial-chat/message-integrity";

const authorId = "11111111-1111-4111-8111-111111111111";
const generalId = "a0000001-0000-4000-8000-000000000001";
const directId = "a0000001-0000-4000-8000-000000000003";
const privateMessage = {
  id: "b0000001-0000-4000-8000-000000000001",
  channel_id: directId,
  author_user_id: authorId,
  body: "private conversation",
  client_message_id: "same-retry-id",
  created_at: "2026-09-16T12:00:00.123456+00:00",
  deleted_at: null,
};

function queryResult(data: unknown, error: unknown = null) {
  const response = { data, error };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(response),
    single: vi.fn().mockResolvedValue(response),
    then: (resolve: (value: typeof response) => unknown) =>
      Promise.resolve(response).then(resolve),
  };
  admin.from.mockReturnValueOnce(query);
  return query;
}

beforeEach(() => admin.from.mockReset());
afterEach(() => vi.useRealTimers());

describe("persistent chat idempotency", () => {
  it("never returns a private message when its retry ID is reused in general", async () => {
    queryResult(privateMessage);
    await expect(
      insertChannelMessage({
        channelId: generalId,
        authorUserId: authorId,
        authorDisplayName: "Author",
        body: "public message",
        clientMessageId: privateMessage.client_message_id,
      }),
    ).rejects.toBeInstanceOf(ChatMessageConflictError);
    expect(admin.from).toHaveBeenCalledTimes(1);
  });

  it("enforces the same audience when concurrent retries hit the unique index", async () => {
    queryResult(null);
    queryResult(null, { code: "23505" });
    queryResult(privateMessage);
    await expect(
      insertChannelMessage({
        channelId: generalId,
        authorUserId: authorId,
        authorDisplayName: "Author",
        body: privateMessage.body,
        clientMessageId: privateMessage.client_message_id,
      }),
    ).rejects.toBeInstanceOf(ChatMessageConflictError);
  });

  it("returns the original message for an identical retry without writing", async () => {
    queryResult(privateMessage);
    const result = await insertChannelMessage({
      channelId: directId,
      authorUserId: authorId,
      authorDisplayName: "Author",
      body: `  ${privateMessage.body}  `,
      clientMessageId: privateMessage.client_message_id,
    });
    expect(result.messageId).toBe(privateMessage.id);
    expect(admin.from).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...privateMessage, body: "different body" },
    { ...privateMessage, deleted_at: "2026-09-16T13:00:00Z" },
  ])("does not resend changed or deleted messages", async (stored) => {
    queryResult(stored);
    await expect(
      insertChannelMessage({
        channelId: directId,
        authorUserId: authorId,
        authorDisplayName: "Author",
        body: privateMessage.body,
        clientMessageId: privateMessage.client_message_id,
      }),
    ).rejects.toBeInstanceOf(ChatMessageConflictError);
  });
});

describe("stable chat pagination", () => {
  it("uses both timestamp and ID to include older messages at the same timestamp", async () => {
    const query = queryResult([]);
    await listChannelMessages({
      channelId: directId,
      cursorCreatedAt: privateMessage.created_at,
      cursorId: privateMessage.id,
      displayNameFor: async () => "Author",
    });
    expect(query.or).toHaveBeenCalledWith(
      `created_at.lt.${privateMessage.created_at},and(created_at.eq.${privateMessage.created_at},id.lt.${privateMessage.id})`,
    );
  });

  it("rejects malformed cursor values before interpolating database filters", async () => {
    const query = queryResult([]);
    await expect(
      listChannelMessages({
        channelId: directId,
        cursorCreatedAt: "2026-09-16T12:00:00Z),channel_id.neq.ignored",
        cursorId: privateMessage.id,
        displayNameFor: async () => "Author",
      }),
    ).rejects.toThrow();
    expect(query.or).not.toHaveBeenCalled();
  });

  it("loses no rows between in-memory pages sharing one timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    const channelId = crypto.randomUUID();
    const ids = Array.from(
      { length: 5 },
      (_, index) =>
        insertEphemeralChannelMessage({
          channelId,
          authorUserId: authorId,
          authorDisplayName: "Author",
          body: `message ${index}`,
        }).messageId,
    );
    const collected: string[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    do {
      const page = await listEphemeralChannelMessages({
        channelId,
        limit: 2,
        ...(cursor
          ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id }
          : {}),
        displayNameFor: async () => "Author",
      });
      collected.push(...page.messages.map((message) => message.messageId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(collected.sort()).toEqual(ids.sort());
  });
});

describe("direct channel recovery", () => {
  const channel = {
    id: directId,
    world_id: "a1000000-0000-4000-8000-000000000001",
    channel_key: `dm:${authorId}:22222222-2222-4222-8222-222222222222`,
    channel_kind: "DIRECT",
    display_name: "Target",
    room_id: "temple-main",
  };
  const input = {
    worldId: channel.world_id,
    requesterUserId: authorId,
    targetUserId: "22222222-2222-4222-8222-222222222222",
    targetDisplayName: "Target",
  };

  it("repairs membership when a previous attempt created only the channel", async () => {
    queryResult(channel);
    const membershipQuery = queryResult(null);
    expect((await getOrCreateDirectChannel(input)).channelId).toBe(directId);
    expect(membershipQuery.upsert).toHaveBeenCalledWith(
      [
        { channel_id: directId, auth_user_id: input.requesterUserId },
        { channel_id: directId, auth_user_id: input.targetUserId },
      ],
      { onConflict: "channel_id,auth_user_id" },
    );
  });

  it("recovers the winning channel when both participants open the DM together", async () => {
    queryResult(null);
    queryResult(null, { code: "23505" });
    queryResult(channel);
    const membershipQuery = queryResult(null);
    expect((await getOrCreateDirectChannel(input)).channelId).toBe(directId);
    expect(membershipQuery.upsert).toHaveBeenCalledOnce();
  });
});
