import { describe, expect, it } from "vitest";

import {
  isValidChatBody,
  normalizeChatBody,
  SPATIAL_CHAT_MAX_BODY_LENGTH,
} from "@virtual-office/shared";

describe("Sprint 7 chat content safety", () => {
  it("I: script-like content is treated as plain text contract", () => {
    const raw = '<img src=x onerror="alert(1)">';
    expect(isValidChatBody(raw)).toBe(true);
    expect(normalizeChatBody(raw)).toBe(raw);
    expect(normalizeChatBody(raw)).not.toContain("&lt;");
  });

  it("rejects empty payloads and oversized bodies", () => {
    expect(isValidChatBody("")).toBe(false);
    expect(isValidChatBody("x".repeat(SPATIAL_CHAT_MAX_BODY_LENGTH + 5))).toBe(
      false,
    );
  });
});
