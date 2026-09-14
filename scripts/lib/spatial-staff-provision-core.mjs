/**
 * Shared staging staff Auth provisioning (identity-only).
 * Target: Recuerda Club Supabase wteymdgzlxrfulmoymlx
 *
 * FUTURE MIGRATION CONTRACT (invariant):
 * - auth.users is canonical; one identity per person.
 * - Later Club profile/membership linking reuses the same auth_user_id by email.
 * - Password set via /recuperar is preserved; do not reset on profile link.
 * - Temporary: Auth-only staff should use Spatial /login only until Recuerda
 *   login hardening avoids synthetic profiles for external identities.
 *
 * AUTHORIZATION (temporary staging):
 * - UNLOCK_ADMIN_EMAILS is staging-only; future staff → club_staff_roles.
 * - Office-only externals → spatial_access_grants (separate sprint).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const EXPECTED_PROJECT_REF = "wteymdgzlxrfulmoymlx";
export const STAFF_VIA = "spatial_staging_staff";

export const STATUS = {
  DRY_RUN_WOULD_CREATE: "DRY_RUN_WOULD_CREATE",
  DRY_RUN_WOULD_REUSE: "DRY_RUN_WOULD_REUSE",
  CREATED: "CREATED",
  REUSED_AUTH_ONLY: "REUSED_AUTH_ONLY",
  CANONICAL_ALREADY_LINKED: "CANONICAL_ALREADY_LINKED",
  BLOCKED_LINKED_PROFILE: "BLOCKED_LINKED_PROFILE",
  BLOCKED_PROFILE_AUTH_MISMATCH: "BLOCKED_PROFILE_AUTH_MISMATCH",
  BLOCKED_STAFF_ROLE: "BLOCKED_STAFF_ROLE",
  BLOCKED_INVALID_EMAIL: "BLOCKED_INVALID_EMAIL",
  BLOCKED_AUTH_ERROR: "BLOCKED_AUTH_ERROR",
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function projectRefFromUrl(url) {
  const match = String(url || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/iu,
  );
  return match ? match[1].toLowerCase() : null;
}

export function loadSupabaseAdminEnv(recuerdaEnvPath) {
  const fileEnv = loadEnvFile(recuerdaEnvPath);
  const url = (fileEnv.SUPABASE_URL || process.env.SUPABASE_URL || "").replace(
    /\/$/u,
    "",
  );
  const key =
    fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  const ref = projectRefFromUrl(url);
  if (ref !== EXPECTED_PROJECT_REF) {
    throw new Error(
      `Refusing to run: expected project ${EXPECTED_PROJECT_REF}, got ${ref ?? "unknown"}`,
    );
  }
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url, key };
}

function normalizeStaffEntry(raw, index) {
  const email = String(raw.email ?? raw.Email ?? "")
    .trim()
    .toLowerCase();
  const displayName = String(
    raw.displayName ?? raw.display_name ?? raw.name ?? "",
  ).trim();
  if (!email || !email.includes("@") || !email.includes(".")) {
    return {
      index,
      email: "",
      displayName,
      valid: false,
    };
  }
  return {
    index,
    email,
    displayName: displayName || email.split("@")[0],
    valid: true,
  };
}

export function loadStaffRoster(rootDir) {
  const jsonPath = path.join(rootDir, "spatial-staff-provision.local.json");
  const legacyEnvPath = path.join(rootDir, ".env.spatial-staff-provision");

  if (fs.existsSync(jsonPath)) {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.staff)
        ? parsed.staff
        : [];
    if (rows.length === 0) {
      throw new Error(
        "spatial-staff-provision.local.json has no staff entries",
      );
    }
    return rows.map((row, index) => normalizeStaffEntry(row, index + 1));
  }

  const legacy = loadEnvFile(legacyEnvPath);
  const email = (
    process.env.SPATIAL_STAFF_EMAIL ||
    legacy.SPATIAL_STAFF_EMAIL ||
    ""
  )
    .trim()
    .toLowerCase();
  const displayName = (
    process.env.SPATIAL_STAFF_DISPLAY_NAME ||
    legacy.SPATIAL_STAFF_DISPLAY_NAME ||
    ""
  ).trim();
  if (!email) {
    throw new Error(
      "Missing roster: create spatial-staff-provision.local.json or .env.spatial-staff-provision",
    );
  }
  return [normalizeStaffEntry({ email, displayName }, 1)];
}

async function findAuthUserId(admin, email) {
  let page = 1;
  while (page <= 30) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function inspectClubState(admin, email, authUserId) {
  const { data: profiles, error: profileErr } = await admin
    .from("profiles")
    .select("source_id,auth_user_id")
    .ilike("email", email);
  if (profileErr) throw profileErr;

  const linked = (profiles ?? []).filter((row) => row.auth_user_id);
  const linkedToSelf =
    authUserId &&
    linked.some((row) => String(row.auth_user_id) === String(authUserId));
  const linkedToOther =
    authUserId &&
    linked.some((row) => String(row.auth_user_id) !== String(authUserId));
  const linkedWithoutKnownAuth = !authUserId && linked.length > 0;

  let profilesByAuth = [];
  if (authUserId) {
    const { data: byAuth, error: byAuthErr } = await admin
      .from("profiles")
      .select("source_id,email")
      .eq("auth_user_id", authUserId);
    if (byAuthErr) throw byAuthErr;
    profilesByAuth = byAuth ?? [];
  }

  let staffRoleCount = 0;
  if (authUserId) {
    const { data: staffRoles, error: staffErr } = await admin
      .from("club_staff_roles")
      .select("id")
      .eq("auth_user_id", authUserId);
    if (staffErr && !String(staffErr.message).includes("does not exist")) {
      throw staffErr;
    }
    staffRoleCount = (staffRoles ?? []).length;
  }

  return {
    linkedToSelf,
    linkedToOther,
    linkedWithoutKnownAuth,
    profilesByAuthCount: profilesByAuth.length,
    staffRoleCount,
  };
}

function classifyBeforeWrite(state, authUserId) {
  if (state.staffRoleCount > 0) return STATUS.BLOCKED_STAFF_ROLE;
  if (state.linkedToOther) return STATUS.BLOCKED_PROFILE_AUTH_MISMATCH;
  if (state.linkedWithoutKnownAuth) return STATUS.BLOCKED_LINKED_PROFILE;
  if (authUserId && state.linkedToSelf) return STATUS.CANONICAL_ALREADY_LINKED;
  return null;
}

export async function provisionStaffEntry(admin, entry, { execute }) {
  if (!entry.valid) {
    return {
      index: entry.index,
      status: STATUS.BLOCKED_INVALID_EMAIL,
      authUserId: null,
      wroteAuth: false,
    };
  }

  const authUserId = await findAuthUserId(admin, entry.email);
  const state = await inspectClubState(admin, entry.email, authUserId);
  const blocked = classifyBeforeWrite(state, authUserId);
  if (blocked) {
    return {
      index: entry.index,
      status: blocked,
      authUserId,
      wroteAuth: false,
    };
  }

  if (!execute) {
    return {
      index: entry.index,
      status: authUserId
        ? STATUS.DRY_RUN_WOULD_REUSE
        : STATUS.DRY_RUN_WOULD_CREATE,
      authUserId,
      wroteAuth: false,
    };
  }

  if (!authUserId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: entry.email,
      email_confirm: true,
      user_metadata: {
        display_name: entry.displayName,
        via: STAFF_VIA,
      },
    });
    if (error) {
      return {
        index: entry.index,
        status: STATUS.BLOCKED_AUTH_ERROR,
        authUserId: null,
        wroteAuth: false,
        detail: error.message,
      };
    }
    const createdId = data.user?.id ?? null;
    if (!createdId) {
      return {
        index: entry.index,
        status: STATUS.BLOCKED_AUTH_ERROR,
        authUserId: null,
        wroteAuth: false,
        detail: "createUser returned no user id",
      };
    }
    return {
      index: entry.index,
      status: STATUS.CREATED,
      authUserId: createdId,
      wroteAuth: true,
    };
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(
    authUserId,
    {
      email_confirm: true,
      user_metadata: {
        display_name: entry.displayName,
        via: STAFF_VIA,
      },
    },
  );
  if (updateErr) {
    return {
      index: entry.index,
      status: STATUS.BLOCKED_AUTH_ERROR,
      authUserId,
      wroteAuth: false,
      detail: updateErr.message,
    };
  }

  return {
    index: entry.index,
    status: STATUS.REUSED_AUTH_ONLY,
    authUserId,
    wroteAuth: true,
  };
}

export function summarizeResults(results, { execute }) {
  const counts = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  return {
    mode: execute ? "execute" : "dry-run",
    project_ref: EXPECTED_PROJECT_REF,
    roster_size: results.length,
    counts,
    entries: results.map((r) => ({
      index: r.index,
      status: r.status,
      auth_user_id: r.authUserId,
      wrote_auth: r.wroteAuth,
      ...(r.detail ? { detail: r.detail } : {}),
    })),
    guarantees: {
      profiles_written: false,
      memberships_written: false,
      entitlements_written: false,
      passwords_assigned: false,
      passwords_overwritten: false,
      auth_users_deleted: false,
    },
  };
}

export function writeUnlockRosterFile(rootDir, roster) {
  const outPath = path.join(
    rootDir,
    "spatial-staff-unlock-admin-emails.local.txt",
  );
  const emails = roster.filter((e) => e.valid).map((e) => e.email);
  fs.writeFileSync(outPath, `${emails.join(",")}\n`, "utf8");
  return outPath;
}
