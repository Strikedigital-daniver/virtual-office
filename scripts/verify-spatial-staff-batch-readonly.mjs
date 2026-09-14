/**
 * Read-only post-provision verification — no PII in stdout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  EXPECTED_PROJECT_REF,
  loadStaffRoster,
  loadSupabaseAdminEnv,
} from "./lib/spatial-staff-provision-core.mjs";

const AUTH_IDS = [
  "982a655b-fb8f-432e-a21b-f247e48ef789",
  "5c8ca5f7-0b6e-4bb5-b1f4-9ffd7674497f",
  "7ba7e300-0674-4ec8-b756-1b6c5b7cb710",
  "7b22c9cf-a244-4f69-bdf6-5b15f90b8cde",
  "31b2d974-c255-4e4d-8167-3682525d8849",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const roster = loadStaffRoster(root);
  if (roster.length !== AUTH_IDS.length) {
    throw new Error("Roster size mismatch with provisioned auth ids");
  }

  const { url, key } = loadSupabaseAdminEnv(
    path.resolve(root, "..", "..", "recuerda app", ".env.supabase"),
  );
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const unlockPath = path.join(
    root,
    "spatial-staff-unlock-admin-emails.local.txt",
  );
  const unlockExists = fs.existsSync(unlockPath);
  const unlockLineCount = unlockExists
    ? fs.readFileSync(unlockPath, "utf8").trim().split(",").filter(Boolean)
        .length
    : 0;

  const checks = [];
  for (let i = 0; i < roster.length; i += 1) {
    const entry = roster[i];
    const authUserId = AUTH_IDS[i];
    const { data: authData, error: authErr } =
      await admin.auth.admin.getUserById(authUserId);
    if (authErr || !authData.user) {
      checks.push({
        index: entry.index,
        auth_user_id: authUserId,
        auth_exists: false,
        blocked: true,
      });
      continue;
    }

    const user = authData.user;
    const meta = user.user_metadata ?? {};
    const emailConfirmed = Boolean(
      user.email_confirmed_at || user.confirmed_at,
    );
    const hasWpUserId = Boolean(meta.wp_user_id);
    const viaOk = meta.via === "spatial_staging_staff";

    const { data: profiles } = await admin
      .from("profiles")
      .select("source_id,auth_user_id")
      .eq("auth_user_id", authUserId);
    const profileCount = (profiles ?? []).length;

    const { data: profilesByEmail } = await admin
      .from("profiles")
      .select("source_id,auth_user_id")
      .ilike("email", entry.email);
    const linkedEmailProfiles = (profilesByEmail ?? []).filter(
      (p) => p.auth_user_id,
    ).length;

    const { data: staffRoles } = await admin
      .from("club_staff_roles")
      .select("id")
      .eq("auth_user_id", authUserId);
    const staffRoleCount = (staffRoles ?? []).length;

    let membershipCount = 0;
    let entitlementCount = 0;
    if ((profiles ?? []).length > 0) {
      const sourceIds = profiles.map((p) => p.source_id).filter(Boolean);
      if (sourceIds.length > 0) {
        const { data: memberships } = await admin
          .from("memberships")
          .select("id")
          .in("profile_source_id", sourceIds);
        membershipCount = (memberships ?? []).length;
        const { data: entitlements } = await admin
          .from("entitlements")
          .select("id")
          .in("profile_source_id", sourceIds);
        entitlementCount = (entitlements ?? []).length;
      }
    }

    const identities = user.identities ?? [];
    const hasPasswordIdentity = identities.some(
      (id) => id.provider === "email" && id.identity_data?.email,
    );

    checks.push({
      index: entry.index,
      auth_user_id: authUserId,
      auth_exists: true,
      email_confirmed: emailConfirmed,
      via_metadata_ok: viaOk,
      wp_user_id_absent: !hasWpUserId,
      profile_rows_for_auth: profileCount,
      linked_profiles_for_email: linkedEmailProfiles,
      membership_rows: membershipCount,
      entitlement_rows: entitlementCount,
      club_staff_role_rows: staffRoleCount,
      password_identity_present: hasPasswordIdentity,
      verification_pass:
        emailConfirmed &&
        viaOk &&
        !hasWpUserId &&
        profileCount === 0 &&
        linkedEmailProfiles === 0 &&
        membershipCount === 0 &&
        entitlementCount === 0 &&
        staffRoleCount === 0,
    });
  }

  console.log(
    JSON.stringify(
      {
        project_ref: EXPECTED_PROJECT_REF,
        roster_size: roster.length,
        unlock_roster_file_exists: unlockExists,
        unlock_roster_entry_count: unlockLineCount,
        checks,
        all_pass: checks.every((c) => c.verification_pass),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ blocked: true, error: err.message }));
  process.exit(1);
});
