import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEMPLE_WORLD_ID, TEMPLE_WORLD_SLUG } from "@virtual-office/shared";

import { ClubSpatialEntitlementProvider } from "@/lib/spatial/club-spatial-entitlement-provider";
import { resolveTempleWorldId } from "@/lib/spatial/resolve-temple-world-id";
import { isRecuerdaStaffAdminViaCompatibilityBridge } from "@/lib/spatial/temporary-compatibility-bridge";

vi.mock("@/lib/env", () => ({
  getPublicEnvironment: vi.fn(),
}));

import { getPublicEnvironment } from "@/lib/env";

const getPublicEnvironmentMock = vi.mocked(getPublicEnvironment);
const STAFF_EMAIL = "staff@recuerda.club";

type QueryResult = { data: unknown; error: { message: string } | null };

function createMockSupabase(options: {
  userId: string | null;
  userEmail?: string | null;
  profile: { source_id: string; display_name: string | null } | null;
  clubAccessActive: boolean | null;
  officeCollaboratorGrant?: boolean;
  officeCollaboratorGrantExpired?: boolean;
  officeCollaboratorGrantRevoked?: boolean;
  templeWorldId?: string | null;
  templeWorldError?: { message: string } | null;
}) {
  const auth = {
    getUser: vi.fn(async () => ({
      data: {
        user: options.userId
          ? {
              id: options.userId,
              email: options.userEmail ?? "member@example.com",
              user_metadata: {},
            }
          : null,
      },
      error: null,
    })),
  };

  const from = vi.fn((table: string) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      insert: vi.fn(async () => {
        throw new Error("entitlements must not be mutated in provider");
      }),
      maybeSingle: vi.fn(async (): Promise<QueryResult> => {
        if (table === "profiles") {
          return { data: options.profile, error: null };
        }
        if (table === "entitlements") {
          if (options.clubAccessActive === null) {
            return { data: null, error: null };
          }
          return { data: { active: options.clubAccessActive }, error: null };
        }
        if (table === "spatial_worlds") {
          if (options.templeWorldError) {
            return { data: null, error: options.templeWorldError };
          }
          if (options.templeWorldId === null) {
            return { data: null, error: null };
          }
          return {
            data: { id: options.templeWorldId ?? TEMPLE_WORLD_ID },
            error: null,
          };
        }
        if (table === "spatial_access_grants") {
          if (options.officeCollaboratorGrantRevoked) {
            return { data: null, error: null };
          }
          if (!options.officeCollaboratorGrant) {
            return { data: null, error: null };
          }
          const expiresAt = options.officeCollaboratorGrantExpired
            ? "2000-01-01T00:00:00.000Z"
            : null;
          return {
            data: {
              grant_type: "OFFICE_COLLABORATOR",
              expires_at: expiresAt,
              revoked_at: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    return builder;
  });

  return { auth, from };
}

describe("isRecuerdaStaffAdminViaCompatibilityBridge", () => {
  const originalEnv = process.env.UNLOCK_ADMIN_EMAILS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.UNLOCK_ADMIN_EMAILS;
    else process.env.UNLOCK_ADMIN_EMAILS = originalEnv;
  });

  it("matches canonical recuerda-app UNLOCK_ADMIN_EMAILS allowlist", () => {
    process.env.UNLOCK_ADMIN_EMAILS = `${STAFF_EMAIL},other@recuerda.club`;
    expect(isRecuerdaStaffAdminViaCompatibilityBridge(STAFF_EMAIL)).toBe(true);
    expect(
      isRecuerdaStaffAdminViaCompatibilityBridge("member@example.com"),
    ).toBe(false);
  });

  it("always includes recuerda-app default unlock admin email", () => {
    process.env.UNLOCK_ADMIN_EMAILS = "";
    expect(
      isRecuerdaStaffAdminViaCompatibilityBridge("low.end.musica@gmail.com"),
    ).toBe(true);
  });
});

describe("resolveTempleWorldId", () => {
  it("returns the database id when temple exists", () => {
    expect(
      resolveTempleWorldId({ id: TEMPLE_WORLD_ID }, null, "staging"),
    ).toEqual({ ok: true, templeWorldId: TEMPLE_WORLD_ID });
  });

  it("fails closed in staging when the temple row is missing", () => {
    expect(resolveTempleWorldId(null, null, "staging")).toEqual({
      ok: false,
      reason: "missing_row",
    });
  });
});

describe("ClubSpatialEntitlementProvider", () => {
  const provider = new ClubSpatialEntitlementProvider();
  const originalUnlockEnv = process.env.UNLOCK_ADMIN_EMAILS;

  beforeEach(() => {
    getPublicEnvironmentMock.mockReturnValue({
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "sb_publishable_example_key_1234",
      appEnvironment: "staging",
    });
    process.env.UNLOCK_ADMIN_EMAILS = STAFF_EMAIL;
  });

  afterEach(() => {
    getPublicEnvironmentMock.mockReset();
    if (originalUnlockEnv === undefined) delete process.env.UNLOCK_ADMIN_EMAILS;
    else process.env.UNLOCK_ADMIN_EMAILS = originalUnlockEnv;
  });

  it("A. allows canonical staff authority when club_access is inactive", async () => {
    const supabase = createMockSupabase({
      userId: "auth-staff-1",
      userEmail: STAFF_EMAIL,
      profile: { source_id: "wp-staff", display_name: "Staff" },
      clubAccessActive: false,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toEqual({
      authUserId: "auth-staff-1",
      profileSourceId: "wp-staff",
      displayName: "Staff",
      templeWorldId: TEMPLE_WORLD_ID,
      accessClass: "RECUERDA_STAFF",
    });
  });

  it("B. allows ordinary members with active club_access", async () => {
    process.env.UNLOCK_ADMIN_EMAILS = "";

    const supabase = createMockSupabase({
      userId: "auth-user-1",
      userEmail: "member@example.com",
      profile: { source_id: "wp-42", display_name: "  Ana  " },
      clubAccessActive: true,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toEqual({
      authUserId: "auth-user-1",
      profileSourceId: "wp-42",
      displayName: "Ana",
      templeWorldId: TEMPLE_WORLD_ID,
      accessClass: "CLUB_MEMBER",
    });
    const profileQuery = supabase.from.mock.results.find(
      (_, index) => supabase.from.mock.calls[index]?.[0] === "profiles",
    )!.value;
    expect(profileQuery.eq).toHaveBeenCalledWith("auth_user_id", "auth-user-1");
    const entitlementQuery = supabase.from.mock.results.find(
      (_, index) => supabase.from.mock.calls[index]?.[0] === "entitlements",
    )!.value;
    expect(entitlementQuery.eq).toHaveBeenCalledWith(
      "profile_source_id",
      "wp-42",
    );
  });

  it("keeps the existing Club precedence for mixed paid membership and Office grants until capabilities are resolved", async () => {
    const supabase = createMockSupabase({
      userId: "auth-user-mixed",
      profile: { source_id: "wp-mixed", display_name: "Miembro" },
      clubAccessActive: true,
      officeCollaboratorGrant: true,
    });
    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toMatchObject({ accessClass: "CLUB_MEMBER" });
  });

  it("bounds the display name to the signed ticket and presence protocol", async () => {
    const supabase = createMockSupabase({
      userId: "auth-user-long-name",
      profile: { source_id: "wp-long-name", display_name: "A".repeat(80) },
      clubAccessActive: true,
    });
    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toMatchObject({ displayName: "A".repeat(40) });
  });

  it("C. denies users without club_access or staff authority", async () => {
    process.env.UNLOCK_ADMIN_EMAILS = "";

    const supabase = createMockSupabase({
      userId: "auth-user-1",
      userEmail: "member@example.com",
      profile: { source_id: "wp-42", display_name: "Ana" },
      clubAccessActive: false,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toBeNull();
  });

  it("D. does not write fake Club entitlements", async () => {
    const supabase = createMockSupabase({
      userId: "auth-staff-1",
      userEmail: STAFF_EMAIL,
      profile: { source_id: "wp-staff", display_name: "Staff" },
      clubAccessActive: false,
    });

    await provider.getSpatialEntitlements(supabase as never);

    for (const call of supabase.from.mock.results) {
      const builder = call.value as {
        insert?: { mock?: { calls: unknown[] } };
      };
      expect(builder.insert?.mock?.calls ?? []).toHaveLength(0);
    }
  });

  it("E. resolves Temple UUID for allowed staff and members", async () => {
    const supabase = createMockSupabase({
      userId: "auth-user-1",
      userEmail: "member@example.com",
      profile: { source_id: "wp-42", display_name: "Ana" },
      clubAccessActive: true,
      templeWorldId: TEMPLE_WORLD_ID,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toMatchObject({
      templeWorldId: TEMPLE_WORLD_ID,
    });

    expect(TEMPLE_WORLD_SLUG).toBe("temple");
    expect(TEMPLE_WORLD_ID).toBe("a1000000-0000-4000-8000-000000000001");
  });

  it("returns null when there is no authenticated user", async () => {
    const supabase = createMockSupabase({
      userId: null,
      profile: null,
      clubAccessActive: null,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toBeNull();
  });

  it("returns null in staging when spatial_worlds row is missing", async () => {
    const supabase = createMockSupabase({
      userId: "auth-user-1",
      userEmail: "member@example.com",
      profile: { source_id: "wp-42", display_name: null },
      clubAccessActive: true,
      templeWorldId: null,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toBeNull();
  });

  it("allows staff without a linked profile row", async () => {
    const supabase = createMockSupabase({
      userId: "auth-staff-2",
      userEmail: STAFF_EMAIL,
      profile: null,
      clubAccessActive: null,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toMatchObject({
      authUserId: "auth-staff-2",
      profileSourceId: "auth-staff-2",
      templeWorldId: TEMPLE_WORLD_ID,
      accessClass: "RECUERDA_STAFF",
    });
  });

  it("allows office collaborators with explicit spatial grant and no club_access", async () => {
    process.env.UNLOCK_ADMIN_EMAILS = "";

    const supabase = createMockSupabase({
      userId: "auth-collab-1",
      userEmail: "collab@example.com",
      profile: null,
      clubAccessActive: null,
      officeCollaboratorGrant: true,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toMatchObject({
      authUserId: "auth-collab-1",
      accessClass: "OFFICE_COLLABORATOR",
      templeWorldId: TEMPLE_WORLD_ID,
    });
  });

  it("H. denies office collaborator when spatial grant is expired", async () => {
    process.env.UNLOCK_ADMIN_EMAILS = "";

    const supabase = createMockSupabase({
      userId: "auth-collab-expired",
      userEmail: "collab-expired@example.com",
      profile: null,
      clubAccessActive: null,
      officeCollaboratorGrant: true,
      officeCollaboratorGrantExpired: true,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toBeNull();
  });

  it("H. denies office collaborator when spatial grant row is revoked", async () => {
    process.env.UNLOCK_ADMIN_EMAILS = "";

    const supabase = createMockSupabase({
      userId: "auth-collab-revoked",
      userEmail: "collab-revoked@example.com",
      profile: null,
      clubAccessActive: null,
      officeCollaboratorGrant: true,
      officeCollaboratorGrantRevoked: true,
    });

    await expect(
      provider.getSpatialEntitlements(supabase as never),
    ).resolves.toBeNull();
  });
});
