import { describe, expect, it } from "vitest";

import {
  canAccessChatChannel,
  canAccessGeneralChat,
  canAccessOfficeChat,
  canCreateDirectMessagePair,
  directChannelKey,
  directMemberUserIds,
  isValidChatBody,
  normalizeChatBody,
  shouldReceiveChatFanOut,
  SPATIAL_CHAT_MAX_BODY_LENGTH,
  visibleChannelsForAccess,
  type SpatialChatChannelSummary,
} from "../src/spatial-chat";

const generalChannel: SpatialChatChannelSummary = {
  channelId: "a0000001-0000-4000-8000-000000000001",
  channelKey: "temple-general",
  channelKind: "GENERAL",
  displayName: "# general",
  roomId: "temple-main",
};

const officeChannel: SpatialChatChannelSummary = {
  channelId: "a0000001-0000-4000-8000-000000000002",
  channelKey: "office",
  channelKind: "OFFICE",
  displayName: "# oficina",
  roomId: "temple-main",
};

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const userC = "33333333-3333-4333-8333-333333333333";

describe("Sprint 7 general chat access", () => {
  it("A/C: club member and staff can access #general", () => {
    expect(canAccessGeneralChat("CLUB_MEMBER")).toBe(true);
    expect(canAccessGeneralChat("RECUERDA_STAFF")).toBe(true);
    expect(
      canAccessChatChannel({
        accessClass: "CLUB_MEMBER",
        channelKind: "GENERAL",
        authUserId: userA,
      }),
    ).toBe(true);
  });

  it("D: office collaborator without club cannot access #general", () => {
    expect(canAccessGeneralChat("OFFICE_COLLABORATOR")).toBe(false);
    expect(
      canAccessChatChannel({
        accessClass: "OFFICE_COLLABORATOR",
        channelKind: "GENERAL",
        authUserId: userA,
      }),
    ).toBe(false);
  });
});

describe("Sprint 7 office chat access", () => {
  it("J/K: staff and collaborator can access #oficina", () => {
    expect(canAccessOfficeChat("RECUERDA_STAFF")).toBe(true);
    expect(canAccessOfficeChat("OFFICE_COLLABORATOR")).toBe(true);
  });

  it("L/M/N: club member cannot access or receive office realtime", () => {
    expect(canAccessOfficeChat("CLUB_MEMBER")).toBe(false);
    expect(
      canAccessChatChannel({
        accessClass: "CLUB_MEMBER",
        channelKind: "OFFICE",
        authUserId: userA,
      }),
    ).toBe(false);
    expect(
      shouldReceiveChatFanOut({
        accessClass: "CLUB_MEMBER",
        userId: userA,
        channelKind: "OFFICE",
      }),
    ).toBe(false);
  });
});

describe("Sprint 7 direct messages", () => {
  const dmKey = directChannelKey(userA, userB);

  it("O: eligible office users can create DM pair", () => {
    expect(
      canCreateDirectMessagePair("RECUERDA_STAFF", "OFFICE_COLLABORATOR"),
    ).toBe(true);
    expect(
      canCreateDirectMessagePair("OFFICE_COLLABORATOR", "OFFICE_COLLABORATOR"),
    ).toBe(true);
  });

  it("P: same pair normalizes to one channel key", () => {
    expect(directChannelKey(userB, userA)).toBe(dmKey);
    expect(directMemberUserIds(dmKey)).toEqual([userA, userB]);
  });

  it("Q/R/S: third party cannot access direct channel", () => {
    expect(
      canAccessChatChannel({
        accessClass: "RECUERDA_STAFF",
        channelKind: "DIRECT",
        memberUserIds: [userA, userB],
        authUserId: userC,
      }),
    ).toBe(false);
    expect(
      shouldReceiveChatFanOut({
        accessClass: "RECUERDA_STAFF",
        userId: userC,
        channelKind: "DIRECT",
        memberUserIds: [userA, userB],
      }),
    ).toBe(false);
  });
});

describe("Sprint 7 message validation", () => {
  it("G: blank message rejected", () => {
    expect(isValidChatBody("   ")).toBe(false);
    expect(isValidChatBody("\n\t")).toBe(false);
  });

  it("H: oversized message rejected", () => {
    expect(isValidChatBody("a".repeat(SPATIAL_CHAT_MAX_BODY_LENGTH + 1))).toBe(
      false,
    );
  });

  it("normalizes Windows line endings", () => {
    expect(normalizeChatBody("hola\r\nmundo")).toBe("hola\nmundo");
  });
});

describe("Sprint 7 channel visibility", () => {
  it("club member sees only #general", () => {
    const visible = visibleChannelsForAccess("CLUB_MEMBER", userA, [
      generalChannel,
      officeChannel,
    ]);
    expect(visible.map((channel) => channel.channelKey)).toEqual([
      "temple-general",
    ]);
  });

  it("office collaborator sees only #oficina and directs", () => {
    const dmChannel: SpatialChatChannelSummary = {
      channelId: "dm-1",
      channelKey: directChannelKey(userA, userB),
      channelKind: "DIRECT",
      displayName: "Persona",
      roomId: "temple-main",
    };
    const visible = visibleChannelsForAccess("OFFICE_COLLABORATOR", userA, [
      generalChannel,
      officeChannel,
      dmChannel,
    ]);
    expect(visible.map((channel) => channel.channelKind)).toEqual([
      "OFFICE",
      "DIRECT",
    ]);
  });
});

describe("Sprint 7 fan-out eligibility", () => {
  it("W: office message fan-out excludes club members outside office chat", () => {
    expect(
      shouldReceiveChatFanOut({
        accessClass: "RECUERDA_STAFF",
        userId: userA,
        channelKind: "OFFICE",
      }),
    ).toBe(true);
    expect(
      shouldReceiveChatFanOut({
        accessClass: "CLUB_MEMBER",
        userId: userB,
        channelKind: "OFFICE",
      }),
    ).toBe(false);
  });

  it("direct fan-out only reaches pair members", () => {
    expect(
      shouldReceiveChatFanOut({
        accessClass: "OFFICE_COLLABORATOR",
        userId: userA,
        channelKind: "DIRECT",
        memberUserIds: [userA, userB],
      }),
    ).toBe(true);
    expect(
      shouldReceiveChatFanOut({
        accessClass: "RECUERDA_STAFF",
        userId: userC,
        channelKind: "DIRECT",
        memberUserIds: [userA, userB],
      }),
    ).toBe(false);
  });
});
