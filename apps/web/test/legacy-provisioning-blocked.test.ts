import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import {
  LEGACY_OFFICE_DISABLED_MESSAGE,
  LEGACY_OFFICE_PROVISIONING_DISABLED,
} from "@/lib/legacy-office-provisioning";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error(
      "createAdminClient must not run while legacy provisioning is disabled",
    );
  }),
}));

import { POST as postAccessLinks } from "@/app/api/admin/access-links/route";
import { POST as postRevokeAccessLink } from "@/app/api/admin/access-links/revoke/route";
import { POST as postInvitations } from "@/app/api/admin/invitations/route";
import { POST as postUsers } from "@/app/api/admin/users/route";
import { POST as postInvitationAccept } from "@/app/api/invitations/accept/route";
import { POST as postJoin } from "@/app/api/join/route";

const OFFICE_ID = "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20";
const LINK_ID = "a69a7f7e-1e3d-45ef-a4e9-2a4512f0ca21";
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01";

function postRequest(
  path: string,
  body: unknown,
  origin = "https://office.test",
): NextRequest {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("legacy office provisioning routes", () => {
  beforeEach(() => {
    expect(LEGACY_OFFICE_PROVISIONING_DISABLED).toBe(true);
  });

  it.each([
    [
      "POST /api/admin/users",
      postUsers,
      {
        officeId: OFFICE_ID,
        username: "testuser",
        password: "password123",
        role: "member",
      },
    ],
    [
      "POST /api/admin/invitations",
      postInvitations,
      {
        officeId: OFFICE_ID,
        email: "friend@example.com",
        role: "member",
        expiresInHours: 24,
      },
    ],
    [
      "POST /api/admin/access-links",
      postAccessLinks,
      {
        officeId: OFFICE_ID,
        memberLabel: "Guest",
        role: "member",
      },
    ],
    [
      "POST /api/admin/access-links/revoke",
      postRevokeAccessLink,
      {
        officeId: OFFICE_ID,
        linkId: LINK_ID,
      },
    ],
    [
      "POST /api/join",
      postJoin,
      {
        token: TOKEN,
        displayName: "Guest",
      },
    ],
    [
      "POST /api/invitations/accept",
      postInvitationAccept,
      {
        token: TOKEN,
        displayName: "Guest",
      },
    ],
  ])(
    "%s returns 410 before any privileged Supabase access",
    async (_label, handler, body) => {
      const response = await handler(postRequest("/api/placeholder", body));
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toEqual({
        error: LEGACY_OFFICE_DISABLED_MESSAGE,
      });
    },
  );
});
