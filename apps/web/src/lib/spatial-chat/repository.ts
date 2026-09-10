import {
  canAccessChatChannel,
  directChannelKey,
  directMemberUserIds,
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

import { createAdminClient } from "@/lib/supabase/admin";

import { isSpatialChatEphemeral } from "./ephemeral";
import {
  ensureEphemeralTempleChatChannels,
  getEphemeralChannelById,
  getOrCreateEphemeralDirectChannel,
  insertEphemeralChannelMessage,
  listEphemeralChannelMessages,
  listEphemeralChannelsForWorld,
  listEphemeralDirectChannelsForUser,
} from "./in-memory-store";

interface ChannelRow {
  id: string;
  world_id: string;
  room_id: string | null;
  zone_key: string | null;
  channel_key: string;
  channel_kind: SpatialChatChannelKind;
  display_name: string;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_user_id: string;
  body: string;
  client_message_id: string | null;
  created_at: string;
}

function mapChannel(row: ChannelRow): SpatialChatChannelSummary {
  return {
    channelId: row.id,
    channelKey: row.channel_key,
    channelKind: row.channel_kind,
    displayName: row.display_name,
    roomId: row.room_id,
  };
}

function mapMessage(
  row: MessageRow,
  displayName: string,
): SpatialChatMessageRecord {
  return {
    messageId: row.id,
    channelId: row.channel_id,
    authorUserId: row.author_user_id,
    displayName,
    body: row.body,
    createdAt: row.created_at,
    clientMessageId: row.client_message_id,
  };
}

export async function ensureCanonicalTempleChatChannels(
  worldId: string,
): Promise<void> {
  if (isSpatialChatEphemeral()) {
    ensureEphemeralTempleChatChannels(worldId);
    return;
  }

  const admin = createAdminClient();
  const { general, office } = await resolveCanonicalChannels(worldId);

  if (!general) {
    const { error } = await admin.from("spatial_chat_channels").upsert(
      {
        id: TEMPLE_GENERAL_CHANNEL_ID,
        world_id: worldId,
        room_id: "temple-main",
        channel_key: TEMPLE_GENERAL_CHANNEL_KEY,
        channel_kind: "GENERAL",
        display_name: "# general",
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  if (!office) {
    const { error } = await admin.from("spatial_chat_channels").upsert(
      {
        id: TEMPLE_OFFICE_CHANNEL_ID,
        world_id: worldId,
        room_id: "temple-main",
        channel_key: TEMPLE_OFFICE_CHANNEL_KEY,
        channel_kind: "OFFICE",
        display_name: "# oficina",
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }
}

export async function listChannelsForWorld(
  worldId: string,
): Promise<SpatialChatChannelSummary[]> {
  if (isSpatialChatEphemeral()) {
    return listEphemeralChannelsForWorld(worldId);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("spatial_chat_channels")
    .select(
      "id, world_id, room_id, zone_key, channel_key, channel_kind, display_name",
    )
    .eq("world_id", worldId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as ChannelRow[]).map(mapChannel);
}

export async function listDirectChannelsForUser(
  worldId: string,
  authUserId: string,
): Promise<SpatialChatChannelSummary[]> {
  if (isSpatialChatEphemeral()) {
    return listEphemeralDirectChannelsForUser(worldId, authUserId);
  }

  const admin = createAdminClient();
  const { data: memberships, error: memberError } = await admin
    .from("spatial_chat_channel_members")
    .select("channel_id")
    .eq("auth_user_id", authUserId);
  if (memberError) throw memberError;
  const channelIds = (memberships ?? []).map((row) => row.channel_id);
  if (channelIds.length === 0) return [];

  const { data, error } = await admin
    .from("spatial_chat_channels")
    .select(
      "id, world_id, room_id, zone_key, channel_key, channel_kind, display_name",
    )
    .eq("world_id", worldId)
    .eq("channel_kind", "DIRECT")
    .in("id", channelIds);
  if (error) throw error;
  return (data as ChannelRow[]).map(mapChannel);
}

export async function getChannelById(
  channelId: string,
): Promise<(SpatialChatChannelSummary & { worldId: string }) | null> {
  if (isSpatialChatEphemeral()) {
    return getEphemeralChannelById(channelId);
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("spatial_chat_channels")
    .select(
      "id, world_id, room_id, zone_key, channel_key, channel_kind, display_name",
    )
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ChannelRow;
  return { ...mapChannel(row), worldId: row.world_id };
}

export async function resolveCanonicalChannels(worldId: string): Promise<{
  general: SpatialChatChannelSummary | null;
  office: SpatialChatChannelSummary | null;
}> {
  const channels = await listChannelsForWorld(worldId);
  return {
    general:
      channels.find(
        (channel) => channel.channelKey === TEMPLE_GENERAL_CHANNEL_KEY,
      ) ?? null,
    office:
      channels.find(
        (channel) => channel.channelKey === TEMPLE_OFFICE_CHANNEL_KEY,
      ) ?? null,
  };
}

export async function getOrCreateDirectChannel(input: {
  worldId: string;
  requesterUserId: string;
  targetUserId: string;
  targetDisplayName: string;
}): Promise<SpatialChatChannelSummary> {
  if (isSpatialChatEphemeral()) {
    return getOrCreateEphemeralDirectChannel(input);
  }

  const channelKey = directChannelKey(
    input.requesterUserId,
    input.targetUserId,
  );
  const admin = createAdminClient();
  const existing = await admin
    .from("spatial_chat_channels")
    .select(
      "id, world_id, room_id, zone_key, channel_key, channel_kind, display_name",
    )
    .eq("world_id", input.worldId)
    .eq("channel_key", channelKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return mapChannel(existing.data as ChannelRow);

  const { data: created, error: createError } = await admin
    .from("spatial_chat_channels")
    .insert({
      id: crypto.randomUUID(),
      world_id: input.worldId,
      room_id: "temple-main",
      channel_key: channelKey,
      channel_kind: "DIRECT",
      display_name: input.targetDisplayName,
    })
    .select(
      "id, world_id, room_id, zone_key, channel_key, channel_kind, display_name",
    )
    .single();
  if (createError) throw createError;

  const memberIds = [input.requesterUserId, input.targetUserId];
  const { error: membersError } = await admin
    .from("spatial_chat_channel_members")
    .upsert(
      memberIds.map((authUserId) => ({
        channel_id: (created as ChannelRow).id,
        auth_user_id: authUserId,
      })),
      { onConflict: "channel_id,auth_user_id" },
    );
  if (membersError) throw membersError;
  return mapChannel(created as ChannelRow);
}

export async function listChannelMessages(input: {
  channelId: string;
  cursorCreatedAt?: string;
  cursorId?: string;
  limit?: number;
  displayNameFor: (userId: string) => Promise<string>;
}): Promise<{
  messages: SpatialChatMessageRecord[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  if (isSpatialChatEphemeral()) {
    return listEphemeralChannelMessages(input);
  }

  const admin = createAdminClient();
  const limit = input.limit ?? SPATIAL_CHAT_PAGE_SIZE;
  let query = admin
    .from("spatial_chat_messages")
    .select(
      "id, channel_id, author_user_id, body, client_message_id, created_at",
    )
    .eq("channel_id", input.channelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (input.cursorCreatedAt) {
    query = query.lt("created_at", input.cursorCreatedAt);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as MessageRow[];
  const displayNames = new Map<string, string>();
  const messages: SpatialChatMessageRecord[] = [];
  for (const row of rows) {
    let displayName = displayNames.get(row.author_user_id);
    if (!displayName) {
      displayName = await input.displayNameFor(row.author_user_id);
      displayNames.set(row.author_user_id, displayName);
    }
    messages.push(mapMessage(row, displayName));
  }

  const last = rows.at(-1);
  const nextCursor =
    rows.length === limit && last
      ? { createdAt: last.created_at, id: last.id }
      : null;

  return { messages: messages.reverse(), nextCursor };
}

export async function insertChannelMessage(input: {
  channelId: string;
  authorUserId: string;
  authorDisplayName: string;
  body: string;
  clientMessageId?: string;
}): Promise<SpatialChatMessageRecord> {
  if (isSpatialChatEphemeral()) {
    return insertEphemeralChannelMessage(input);
  }

  const admin = createAdminClient();
  const normalizedBody = normalizeChatBody(input.body);
  if (input.clientMessageId) {
    const existing = await admin
      .from("spatial_chat_messages")
      .select(
        "id, channel_id, author_user_id, body, client_message_id, created_at",
      )
      .eq("author_user_id", input.authorUserId)
      .eq("client_message_id", input.clientMessageId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      return mapMessage(existing.data as MessageRow, input.authorDisplayName);
    }
  }

  const { data, error } = await admin
    .from("spatial_chat_messages")
    .insert({
      id: crypto.randomUUID(),
      channel_id: input.channelId,
      author_user_id: input.authorUserId,
      body: normalizedBody,
      ...(input.clientMessageId
        ? { client_message_id: input.clientMessageId }
        : {}),
    })
    .select(
      "id, channel_id, author_user_id, body, client_message_id, created_at",
    )
    .single();
  if (error) {
    if (input.clientMessageId && error.code === "23505") {
      const existing = await admin
        .from("spatial_chat_messages")
        .select(
          "id, channel_id, author_user_id, body, client_message_id, created_at",
        )
        .eq("author_user_id", input.authorUserId)
        .eq("client_message_id", input.clientMessageId)
        .single();
      if (existing.error) throw existing.error;
      return mapMessage(existing.data as MessageRow, input.authorDisplayName);
    }
    throw error;
  }
  return mapMessage(data as MessageRow, input.authorDisplayName);
}

export function channelMemberUserIds(
  channel: SpatialChatChannelSummary,
): string[] | undefined {
  if (channel.channelKind !== "DIRECT") return undefined;
  return directMemberUserIds(channel.channelKey) ?? undefined;
}

export function assertChannelAccess(input: {
  accessClass: Parameters<typeof canAccessChatChannel>[0]["accessClass"];
  authUserId: string;
  channel: SpatialChatChannelSummary;
}): boolean {
  const members = channelMemberUserIds(input.channel);
  return canAccessChatChannel({
    accessClass: input.accessClass,
    channelKind: input.channel.channelKind,
    authUserId: input.authUserId,
    ...(members ? { memberUserIds: members } : {}),
  });
}
