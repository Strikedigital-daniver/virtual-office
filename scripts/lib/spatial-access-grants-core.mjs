/**
 * Shared helpers for spatial_access_grants (Club Supabase wteymdgzlxrfulmoymlx).
 */
import fs from "node:fs";
import path from "node:path";

import {
  EXPECTED_PROJECT_REF,
  loadStaffRoster,
  loadSupabaseAdminEnv,
} from "./spatial-staff-provision-core.mjs";

export const TEMPLE_WORLD_ID = "a1000000-0000-4000-8000-000000000001";
export const OFFICE_ZONE_KEY = "office";
export const OFFICE_COLLABORATOR_GRANT = "OFFICE_COLLABORATOR";

const DEFAULT_UNLOCK_ADMIN_EMAILS = ["low.end.musica@gmail.com"];

export { EXPECTED_PROJECT_REF, loadSupabaseAdminEnv };

export function loadCollaboratorSelection(rootDir) {
  const configPath = path.join(
    rootDir,
    "spatial-office-collaborator.local.json",
  );
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "Missing spatial-office-collaborator.local.json (copy from .example)",
    );
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const rosterIndex = Number(parsed.rosterIndex);
  if (!Number.isInteger(rosterIndex) || rosterIndex < 1) {
    throw new Error(
      "spatial-office-collaborator.local.json requires rosterIndex >= 1",
    );
  }
  const roster = loadStaffRoster(rootDir);
  const entry = roster.find((row) => row.index === rosterIndex);
  if (!entry?.valid) {
    throw new Error(`Invalid roster entry at index ${rosterIndex}`);
  }
  return { rosterIndex, entry };
}

export function readUnlockAdminEmailSet(rootDir) {
  const emails = new Set(
    DEFAULT_UNLOCK_ADMIN_EMAILS.map((email) => email.toLowerCase()),
  );
  const unlockPath = path.join(
    rootDir,
    "spatial-staff-unlock-admin-emails.local.txt",
  );
  if (fs.existsSync(unlockPath)) {
    for (const part of fs.readFileSync(unlockPath, "utf8").split(",")) {
      const email = part.trim().toLowerCase();
      if (email) emails.add(email);
    }
  }
  const fromEnv = (process.env.UNLOCK_ADMIN_EMAILS || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  for (const email of fromEnv) emails.add(email);
  return emails;
}

async function findAuthUserId(admin, email) {
  let page = 1;
  while (page <= 30) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find((user) => user.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

export async function inspectCollaboratorEligibility(admin, email) {
  const authUserId = await findAuthUserId(admin, email);
  if (!authUserId) {
    return {
      authUserId: null,
      hasClubAccess: false,
      staffRoleCount: 0,
      profileLinked: false,
      activeGrantCount: 0,
    };
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("source_id,auth_user_id")
    .eq("auth_user_id", authUserId);
  const profileLinked = (profiles ?? []).length > 0;

  let hasClubAccess = false;
  const sourceIds = (profiles ?? [])
    .map((row) => row.source_id)
    .filter(Boolean);
  if (sourceIds.length > 0) {
    const { data: entitlement } = await admin
      .from("entitlements")
      .select("active")
      .eq("key", "club_access")
      .in("profile_source_id", sourceIds)
      .maybeSingle();
    hasClubAccess = Boolean(entitlement?.active);
  }

  const { data: staffRoles, error: staffErr } = await admin
    .from("club_staff_roles")
    .select("id")
    .eq("auth_user_id", authUserId);
  if (staffErr && !String(staffErr.message).includes("does not exist")) {
    throw staffErr;
  }

  const { count: activeGrantCount, error: grantErr } = await admin
    .from("spatial_access_grants")
    .select("id", { count: "exact", head: true })
    .eq("auth_user_id", authUserId)
    .eq("world_id", TEMPLE_WORLD_ID)
    .eq("zone_key", OFFICE_ZONE_KEY)
    .eq("grant_type", OFFICE_COLLABORATOR_GRANT)
    .is("revoked_at", null);
  if (grantErr) throw grantErr;

  return {
    authUserId,
    hasClubAccess,
    staffRoleCount: (staffRoles ?? []).length,
    profileLinked,
    activeGrantCount: activeGrantCount ?? 0,
  };
}

export async function upsertOfficeCollaboratorGrant(
  admin,
  authUserId,
  grantedBy,
) {
  const { data: existing, error: existingErr } = await admin
    .from("spatial_access_grants")
    .select("id, expires_at, revoked_at")
    .eq("auth_user_id", authUserId)
    .eq("world_id", TEMPLE_WORLD_ID)
    .eq("zone_key", OFFICE_ZONE_KEY)
    .eq("grant_type", OFFICE_COLLABORATOR_GRANT)
    .is("revoked_at", null)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    return {
      action: "reused_active_grant",
      grantId: existing.id,
      wrote: false,
    };
  }

  const row = {
    auth_user_id: authUserId,
    world_id: TEMPLE_WORLD_ID,
    zone_key: OFFICE_ZONE_KEY,
    grant_type: OFFICE_COLLABORATOR_GRANT,
    expires_at: null,
    revoked_at: null,
    ...(grantedBy ? { granted_by: grantedBy } : {}),
  };

  const { data: inserted, error: insertErr } = await admin
    .from("spatial_access_grants")
    .insert(row)
    .select("id")
    .single();
  if (insertErr) throw insertErr;

  return {
    action: "inserted_grant",
    grantId: inserted.id,
    wrote: true,
  };
}
