import {
  TEMPLE_WORLD_ID,
  TEMPLE_WORLD_SLUG,
  type SpatialAccessClass,
} from "@virtual-office/shared";

import { getPublicEnvironment } from "@/lib/env";

import { resolveTempleWorldId } from "./resolve-temple-world-id";
import { isRecuerdaStaffAdminViaCompatibilityBridge } from "./temporary-compatibility-bridge";
import type {
  SpatialEntitlementProvider,
  SpatialEntitlements,
  SupabaseServerClient,
} from "./types";

async function resolveTempleWorld(
  supabase: SupabaseServerClient,
): Promise<string | null> {
  const { data: world, error: worldError } = await supabase
    .from("spatial_worlds")
    .select("id")
    .eq("slug", TEMPLE_WORLD_SLUG)
    .maybeSingle();

  const worldResolution = resolveTempleWorldId(
    world,
    worldError,
    getPublicEnvironment()?.appEnvironment ?? null,
  );
  return worldResolution.ok ? worldResolution.templeWorldId : null;
}

async function hasActiveOfficeCollaboratorGrant(
  supabase: SupabaseServerClient,
  authUserId: string,
  templeWorldId: string,
): Promise<boolean> {
  const { data: grant, error } = await supabase
    .from("spatial_access_grants")
    .select("expires_at, revoked_at, grant_type")
    .eq("auth_user_id", authUserId)
    .eq("world_id", templeWorldId)
    .eq("zone_key", "office")
    .eq("grant_type", "OFFICE_COLLABORATOR")
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !grant) return false;
  if (grant.expires_at && new Date(grant.expires_at) <= new Date()) {
    return false;
  }
  return true;
}

function displayNameFor(
  user: { user_metadata?: Record<string, unknown> },
  profile: { display_name?: string | null } | null,
): string {
  const metadataName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  return (profile?.display_name?.trim() || metadataName || "Integrante").slice(
    0,
    40,
  );
}

export class ClubSpatialEntitlementProvider implements SpatialEntitlementProvider {
  async getSpatialEntitlements(
    supabase: SupabaseServerClient,
  ): Promise<SpatialEntitlements | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const templeWorldId = await resolveTempleWorld(supabase);
    if (!templeWorldId) return null;

    const isStaffAdmin = isRecuerdaStaffAdminViaCompatibilityBridge(user.email);

    const { data: profile } = await supabase
      .from("profiles")
      .select("source_id, display_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    let hasClubAccess = false;
    if (profile?.source_id) {
      const { data: entitlement } = await supabase
        .from("entitlements")
        .select("active")
        .eq("key", "club_access")
        .eq("profile_source_id", profile.source_id)
        .maybeSingle();
      hasClubAccess = Boolean(entitlement?.active);
    }

    let accessClass: SpatialAccessClass | null = null;
    if (isStaffAdmin) {
      accessClass = "RECUERDA_STAFF";
    } else if (hasClubAccess && profile?.source_id) {
      accessClass = "CLUB_MEMBER";
    } else if (
      await hasActiveOfficeCollaboratorGrant(supabase, user.id, templeWorldId)
    ) {
      accessClass = "OFFICE_COLLABORATOR";
    }

    if (!accessClass) return null;
    if (
      !isStaffAdmin &&
      !profile?.source_id &&
      accessClass !== "OFFICE_COLLABORATOR"
    ) {
      return null;
    }

    return {
      authUserId: user.id,
      profileSourceId: profile?.source_id ?? user.id,
      displayName: displayNameFor(user, profile),
      templeWorldId,
      accessClass,
    };
  }
}

export const clubSpatialEntitlementProvider =
  new ClubSpatialEntitlementProvider();

export { TEMPLE_WORLD_ID };
