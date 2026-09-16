import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(),
  requireChannel: vi.fn(),
  insertMessage: vi.fn(),
  listMessages: vi.fn(),
  fanOut: vi.fn(),
}));
vi.mock("@/lib/spatial-chat/context", () => ({
  requireSpatialChatContext: mocks.requireContext,
  requireAccessibleChannel: mocks.requireChannel,
  resolveDisplayName: vi.fn(),
}));
vi.mock("@/lib/spatial-chat/repository", () => ({
  insertChannelMessage: mocks.insertMessage,
  listChannelMessages: mocks.listMessages,
  channelMemberUserIds: vi.fn(),
}));
vi.mock("@/lib/spatial-chat/fanout", () => ({
  fanOutSpatialChatMessage: mocks.fanOut,
}));

import { GET, POST } from "@/app/api/spatial-chat/messages/route";
import { ChatMessageConflictError } from "@/lib/spatial-chat/message-integrity";

const channelId = "a0000001-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireContext.mockResolvedValue({
    authUserId: "author",
    templeWorldId: "temple",
    displayName: "Author",
  });
  mocks.requireChannel.mockResolvedValue({ channelId, channelKind: "GENERAL" });
});

describe("chat audience protection at API boundary", () => {
  it("returns conflict and never fans out a reused ID with another audience", async () => {
    mocks.insertMessage.mockRejectedValue(new ChatMessageConflictError());
    const response = await POST(
      new NextRequest("https://office.test/api/spatial-chat/messages", {
        method: "POST",
        headers: {
          Origin: "https://office.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channelId,
          body: "public message",
          clientMessageId: "private-message-id",
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.fanOut).not.toHaveBeenCalled();
  });

  it("rejects an incomplete history cursor before reading messages", async () => {
    const response = await GET(
      new NextRequest(
        `https://office.test/api/spatial-chat/messages?channelId=${channelId}&cursorCreatedAt=2026-09-16T12:00:00Z`,
      ),
    );
    expect(response.status).toBe(400);
    expect(mocks.listMessages).not.toHaveBeenCalled();
  });
});
