import { describe, expect, it } from "vitest";

import { InviteTokenSchema } from "@virtual-office/shared";

import { safeRedirectPath, safeSameOriginRedirect } from "@/lib/safe-redirect";
import { generateInviteToken, isSameOrigin, sha256Hex } from "@/lib/security";

describe("web security boundaries", () => {
  it("accepts local redirects and rejects external or protocol-relative redirects", () => {
    expect(safeRedirectPath("/office/mhcave?from=invite")).toBe(
      "/office/mhcave?from=invite",
    );
    expect(safeRedirectPath("https://attacker.test/steal")).toBe("/");
    expect(safeRedirectPath("//attacker.test/steal")).toBe("/");
    expect(
      safeSameOriginRedirect(
        "https://office.test/invite/token",
        "https://office.test",
      ),
    ).toBe("/invite/token");
    expect(
      safeSameOriginRedirect(
        "https://attacker.test/steal",
        "https://office.test",
      ),
    ).toBe("/");
  });

  it("creates a valid opaque token and hashes it deterministically", async () => {
    const token = generateInviteToken();
    expect(InviteTokenSchema.safeParse(token).success).toBe(true);
    expect(token).toHaveLength(43);
    await expect(sha256Hex(token)).resolves.toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rejects cross-origin state-changing requests", () => {
    const request = new Request("https://office.test/api/invitations/accept", {
      method: "POST",
      headers: { Origin: "https://attacker.test" },
    });
    expect(isSameOrigin(request)).toBe(false);
  });
});
