import { describe, expect, it } from "vitest";

import {
  AccessLinkCreateInputSchema,
  AccessLinkRedeemInputSchema,
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

describe("shared access link contracts", () => {
  it("accepts a link without email and normalizes one when present", () => {
    const withoutEmail = AccessLinkCreateInputSchema.parse({
      officeId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
      memberLabel: "  Amiga  ",
      role: "member",
    });
    expect(withoutEmail.email).toBeUndefined();
    expect(withoutEmail.memberLabel).toBe("Amiga");

    const withEmail = AccessLinkCreateInputSchema.parse({
      officeId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
      memberLabel: "Amigo",
      email: "  FRIEND@Example.COM ",
      role: "freelancer",
    });
    expect(withEmail.email).toBe("friend@example.com");
  });

  it("rejects owner links and malformed redeem tokens", () => {
    expect(
      AccessLinkCreateInputSchema.safeParse({
        officeId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
        memberLabel: "Amigo",
        role: "owner",
      }).success,
    ).toBe(false);
    expect(
      AccessLinkRedeemInputSchema.safeParse({
        token: "short",
        displayName: "Ana",
      }).success,
    ).toBe(false);
  });
});
