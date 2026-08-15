import { describe, expect, it } from "vitest";

import {
  buildJoinUrl,
  resolveAccessLinkEmail,
  syntheticAccessLinkEmail,
} from "@/lib/access-links";

describe("access link helpers", () => {
  it("builds a join URL from the request origin", () => {
    expect(buildJoinUrl("https://office.example.com", "abc123")).toBe(
      "https://office.example.com/join/abc123",
    );
  });

  it("synthesizes a reserved-domain email bound to the link id", () => {
    const email = syntheticAccessLinkEmail(
      "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
    );
    expect(email).toBe(
      "link-f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20@members.virtual-office.invalid",
    );
    expect(email.endsWith(".invalid")).toBe(true);
  });

  it("prefers the stored email when the link has one", () => {
    expect(
      resolveAccessLinkEmail(
        "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
        "friend@example.com",
      ),
    ).toBe("friend@example.com");
    expect(
      resolveAccessLinkEmail("f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20", null),
    ).toBe(
      "link-f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20@members.virtual-office.invalid",
    );
  });
});
