import {
  directChannelKey,
  normalizeChatBody,
  SPATIAL_CHAT_PAGE_SIZE,
  TEMPLE_GENERAL_CHANNEL_ID,
  TEMPLE_GENERAL_CHANNEL_KEY,
  TEMPLE_OFFICE_CHANNEL_ID,
  TEMPLE_OFFICE_CHANNEL_KEY,
  type SpatialChatChannelKind,
  type SpatialChatChannelSummary,
  type SpatialChatMessageRecord,
} from "@virtual-office/shared";

interface StoredChannel {
  id: string;
  worldId: string;
  roomId: string | null;
  channelKey: string;
  channelKind: SpatialChatChannelKind;
  displayName: string;
  createdAt: string;
}

interface StoredMessage {
  id: string;
  channelId: string;
  authorUserId: string;
  body: string;
  clientMessageId: string | null;
  createdAt: string;
}

const channelsByWorld = new Map<string, Map<string, StoredChannel>>();
const messagesByChannel = new Map<string, StoredMessage[]>();
const directMembersByChannel = new Map<string, string[]>();

function worldChannels(worldId: string): Map<string, StoredChannel> {
  let channels = channelsByWorld.get(worldId);
  if (!channels) {
    channels = new Map();
    channelsByWorld.set(worldId, channels);
  }
  return channels;
}

function mapChannel(row: StoredChannel): SpatialChatChannelSummary {
  return {
    channelId: row.id,
    channelKey: row.channelKey,
    channelKind: row.channelKind,
    displayName: row.displayName,
    roomId: row.roomId,
  };
}

function mapMessage(
  row: StoredMessage,
  displayName: string,
): SpatialChatMessageRecord {
  return {
    messageId: row.id,
    channelId: row.channelId,
    authorUserId: row.authorUserId,
    displayName,
    body: row.body,
    createdAt: row.createdAt,
    clientMessageId: row.clientMessageId,
  };
}

function seedCanonicalChannels(worldId: string): void {
  const channels = worldChannels(worldId);
  if (!channels.has(TEMPLE_GENERAL_CHANNEL_ID)) {
    channels.set(TEMPLE_GENERAL_CHANNEL_ID, {
      id: TEMPLE_GENERAL_CHANNEL_ID,
      worldId,
      roomId: "temple-main",
      channelKey: TEMPLE_GENERAL_CHANNEL_KEY,
      channelKind: "GENERAL",
      displayName: "# general",
      createdAt: new Date(0).toISOString(),
    });
  }
  if (!channels.has(TEMPLE_OFFICE_CHANNEL_ID)) {
    channels.set(TEMPLE_OFFICE_CHANNEL_ID, {
      id: TEMPLE_OFFICE_CHANNEL_ID,
      worldId,
      roomId: "temple-main",
      channelKey: TEMPLE_OFFICE_CHANNEL_KEY,
      channelKind: "OFFICE",
      displayName: "# oficina",
      createdAt: new Date(1).toISOString(),
    });
  }
}

export function ensureEphemeralTempleChatChannels(worldId: string): void {
  seedCanonicalChannels(worldId);
}

export function listEphemeralChannelsForWorld(
  worldId: string,
): SpatialChatChannelSummary[] {
  seedCanonicalChannels(worldId);
  return [...worldChannels(worldId).values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(mapChannel);
}

export function listEphemeralDirectChannelsForUser(
  worldId: string,
  authUserId: string,
): SpatialChatChannelSummary[] {
  return listEphemeralChannelsForWorld(worldId).filter((channel) => {
    if (channel.channelKind !== "DIRECT") return false;
    const members = directMembersByChannel.get(channel.channelId);
    return members?.includes(authUserId) ?? false;
  });
}

export function getEphemeralChannelById(
  channelId: string,
): (SpatialChatChannelSummary & { worldId: string }) | null {
  for (const [worldId, channels] of channelsByWorld) {
    const channel = channels.get(channelId);
    if (!channel) continue;
    return { ...mapChannel(channel), worldId };
  }
  return null;
}

export function getOrCreateEphemeralDirectChannel(input: {
  worldId: string;
  requesterUserId: string;
  targetUserId: string;
  targetDisplayName: string;
}): SpatialChatChannelSummary {
  seedCanonicalChannels(input.worldId);
  const channelKey = directChannelKey(
    input.requesterUserId,
    input.targetUserId,
  );
  const existing = [...worldChannels(input.worldId).values()].find(
    (channel) => channel.channelKey === channelKey,
  );
  if (existing) return mapChannel(existing);

  const created: StoredChannel = {
    id: crypto.randomUUID(),
    worldId: input.worldId,
    roomId: "temple-main",
    channelKey,
    channelKind: "DIRECT",
    displayName: input.targetDisplayName,
    createdAt: new Date().toISOString(),
  };
  worldChannels(input.worldId).set(created.id, created);
  directMembersByChannel.set(created.id, [
    input.requesterUserId,
    input.targetUserId,
  ]);
  return mapChannel(created);
}

export async function listEphemeralChannelMessages(input: {
  channelId: string;
  cursorCreatedAt?: string;
  limit?: number;
  displayNameFor: (userId: string) => Promise<string>;
}): Promise<{
  messages: SpatialChatMessageRecord[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const limit = input.limit ?? SPATIAL_CHAT_PAGE_SIZE;
  const rows = [...(messagesByChannel.get(input.channelId) ?? [])].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  );
  const filtered = input.cursorCreatedAt
    ? rows.filter((row) => row.createdAt < input.cursorCreatedAt!)
    : rows;
  const page = filtered.slice(0, limit);
  const displayNames = new Map<string, string>();
  const messages: SpatialChatMessageRecord[] = [];
  for (const row of page) {
    let displayName = displayNames.get(row.authorUserId);
    if (!displayName) {
      displayName = await input.displayNameFor(row.authorUserId);
      displayNames.set(row.authorUserId, displayName);
    }
    messages.push(mapMessage(row, displayName));
  }
  const last = page.at(-1);
  const nextCursor =
    page.length === limit && last
      ? { createdAt: last.createdAt, id: last.id }
      : null;
  return { messages: messages.reverse(), nextCursor };
}

export function insertEphemeralChannelMessage(input: {
  channelId: string;
  authorUserId: string;
  authorDisplayName: string;
  body: string;
  clientMessageId?: string;
}): SpatialChatMessageRecord {
  const normalizedBody = normalizeChatBody(input.body);
  const existingRows = messagesByChannel.get(input.channelId) ?? [];
  if (input.clientMessageId) {
    const existing = existingRows.find(
      (row) =>
        row.authorUserId === input.authorUserId &&
        row.clientMessageId === input.clientMessageId,
    );
    if (existing) {
      return mapMessage(existing, input.authorDisplayName);
    }
  }

  const created: StoredMessage = {
    id: crypto.randomUUID(),
    channelId: input.channelId,
    authorUserId: input.authorUserId,
    body: normalizedBody,
    clientMessageId: input.clientMessageId ?? null,
    createdAt: new Date().toISOString(),
  };
  messagesByChannel.set(input.channelId, [...existingRows, created]);
  return mapMessage(created, input.authorDisplayName);
}
