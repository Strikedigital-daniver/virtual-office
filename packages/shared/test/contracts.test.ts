import { describe, expect, it } from "vitest";

import {
  InvitationAcceptInputSchema,
  InvitationCreateInputSchema,
  OfficeRoleSchema,
} from "../src/index";

describe("shared invitation contracts", () => {
  it("normalizes an invited email and applies a bounded expiry", () => {
    const result = InvitationCreateInputSchema.parse({
      officeId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
      email: "  FRIEND@Example.COM ",
      role: "member",
    });

    expect(result.email).toBe("friend@example.com");
    expect(result.expiresInHours).toBe(24);
  });

  it("rejects owner invitations and malformed acceptance tokens", () => {
    expect(
      InvitationCreateInputSchema.safeParse({
        officeId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
        email: "friend@example.com",
        role: "owner",
      }).success,
    ).toBe(false);
    expect(
      InvitationAcceptInputSchema.safeParse({
        token: "not a token",
        displayName: "Ana",
      }).success,
    ).toBe(false);
    expect(OfficeRoleSchema.options).toContain("owner");
  });
});
