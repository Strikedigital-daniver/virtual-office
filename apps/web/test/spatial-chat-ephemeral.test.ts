import { describe, expect, it } from "vitest";

import {
  ensureEphemeralTempleChatChannels,
  getEphemeralChannelById,
  insertEphemeralChannelMessage,
  listEphemeralChannelMessages,
  listEphemeralChannelsForWorld,
} from "@/lib/spatial-chat/in-memory-store";
import {
  TEMPLE_GENERAL_CHANNEL_ID,
  TEMPLE_OFFICE_CHANNEL_ID,
} from "@virtual-office/shared";

describe("spatial chat ephemeral store", () => {
  it("seeds canonical temple channels and stores messages in memory", async () => {
    const worldId = "world-test-1";
    ensureEphemeralTempleChatChannels(worldId);
    const channels = listEphemeralChannelsForWorld(worldId);
    expect(channels.map((channel) => channel.channelId)).toEqual([
      TEMPLE_GENERAL_CHANNEL_ID,
      TEMPLE_OFFICE_CHANNEL_ID,
    ]);

    const message = insertEphemeralChannelMessage({
      channelId: TEMPLE_GENERAL_CHANNEL_ID,
      authorUserId: "11111111-1111-4111-8111-111111111111",
      authorDisplayName: "Tester",
      body: "hola",
      clientMessageId: "client-msg-1",
    });
    expect(message.body).toBe("hola");

    const page = await listEphemeralChannelMessages({
      channelId: TEMPLE_GENERAL_CHANNEL_ID,
      displayNameFor: async () => "Tester",
    });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.messageId).toBe(message.messageId);

    const channel = getEphemeralChannelById(TEMPLE_GENERAL_CHANNEL_ID);
    expect(channel?.worldId).toBe(worldId);
  });
});
