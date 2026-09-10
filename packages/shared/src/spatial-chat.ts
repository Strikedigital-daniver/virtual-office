import type { SpatialAccessClass } from "./spatial-access";

export const SPATIAL_CHAT_MAX_BODY_LENGTH = 2_000;
export const SPATIAL_CHAT_PAGE_SIZE = 50;

export const SpatialChatChannelKindSchema = [
  "GENERAL",
  "OFFICE",
  "DIRECT",
  "ZONE",
] as const;

export type SpatialChatChannelKind =
  (typeof SpatialChatChannelKindSchema)[number];

export const TEMPLE_GENERAL_CHANNEL_KEY = "temple-general";
export const TEMPLE_OFFICE_CHANNEL_KEY = "office";
export const TEMPLE_GENERAL_CHANNEL_ID = "a0000001-0000-4000-8000-000000000001";
export const TEMPLE_OFFICE_CHANNEL_ID = "a0000001-0000-4000-8000-000000000002";

export interface SpatialChatChannelSummary {
  channelId: string;
  channelKey: string;
  channelKind: SpatialChatChannelKind;
  displayName: string;
  roomId: string | null;
}

export interface SpatialChatMessageRecord {
  messageId: string;
  channelId: string;
  authorUserId: string;
  displayName: string;
  body: string;
  createdAt: string;
  clientMessageId: string | null;
}

export interface SpatialChatMessageCreatedEvent {
  type: "chat.message.created";
  messageId: string;
  channelId: string;
  channelKind: SpatialChatChannelKind;
  authorUserId: string;
  displayName: string;
  body: string;
  createdAt: string;
  memberUserIds?: string[];
}

export function normalizeChatBody(body: string): string {
  return body.replace(/\r\n?/gu, "\n").trim();
}

export function isValidChatBody(body: string): boolean {
  const normalized = normalizeChatBody(body);
  return (
    normalized.length > 0 && normalized.length <= SPATIAL_CHAT_MAX_BODY_LENGTH
  );
}

export function canAccessGeneralChat(accessClass: SpatialAccessClass): boolean {
  return accessClass === "CLUB_MEMBER" || accessClass === "RECUERDA_STAFF";
}

export function canAccessOfficeChat(accessClass: SpatialAccessClass): boolean {
  return (
    accessClass === "RECUERDA_STAFF" || accessClass === "OFFICE_COLLABORATOR"
  );
}

export function canUseOfficeDirectMessages(
  accessClass: SpatialAccessClass,
): boolean {
  return canAccessOfficeChat(accessClass);
}

export function canCreateDirectMessagePair(
  requesterAccessClass: SpatialAccessClass,
  targetAccessClass: SpatialAccessClass,
): boolean {
  return (
    canUseOfficeDirectMessages(requesterAccessClass) &&
    canUseOfficeDirectMessages(targetAccessClass)
  );
}

export function canAccessChatChannel(input: {
  accessClass: SpatialAccessClass;
  channelKind: SpatialChatChannelKind;
  memberUserIds?: string[];
  authUserId: string;
}): boolean {
  switch (input.channelKind) {
    case "GENERAL":
      return canAccessGeneralChat(input.accessClass);
    case "OFFICE":
      return canAccessOfficeChat(input.accessClass);
    case "DIRECT": {
      const members = input.memberUserIds ?? [];
      return (
        members.length === 2 &&
        members.includes(input.authUserId) &&
        canUseOfficeDirectMessages(input.accessClass)
      );
    }
    case "ZONE":
      return false;
    default:
      return false;
  }
}

export function directChannelKey(userIdA: string, userIdB: string): string {
  const [left, right] = [userIdA, userIdB].sort();
  return `dm:${left}:${right}`;
}

export function directMemberUserIds(channelKey: string): string[] | null {
  const match = /^dm:([0-9a-f-]{36}):([0-9a-f-]{36})$/u.exec(channelKey);
  if (!match) return null;
  return [match[1]!, match[2]!];
}

export function shouldReceiveChatFanOut(input: {
  accessClass: SpatialAccessClass;
  userId: string;
  channelKind: SpatialChatChannelKind;
  memberUserIds?: string[];
}): boolean {
  return canAccessChatChannel({
    accessClass: input.accessClass,
    channelKind: input.channelKind,
    authUserId: input.userId,
    ...(input.memberUserIds ? { memberUserIds: input.memberUserIds } : {}),
  });
}

export function visibleChannelsForAccess(
  accessClass: SpatialAccessClass,
  authUserId: string,
  channels: SpatialChatChannelSummary[],
): SpatialChatChannelSummary[] {
  return channels.filter((channel) =>
    canAccessChatChannel({
      accessClass,
      channelKind: channel.channelKind,
      authUserId,
      ...(channel.channelKind === "DIRECT"
        ? (() => {
            const members = directMemberUserIds(channel.channelKey);
            return members ? { memberUserIds: members } : {};
          })()
        : {}),
    }),
  );
}
