/**
 * Idempotent OFFICE_COLLABORATOR grant for one selected external worker.
 *
 * Default: dry-run. Execute with --execute.
 *
 * Config (gitignored): spatial-office-collaborator.local.json
 *   { "rosterIndex": 1 }
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  EXPECTED_PROJECT_REF,
  inspectCollaboratorEligibility,
  loadCollaboratorSelection,
  loadSupabaseAdminEnv,
  readUnlockAdminEmailSet,
  upsertOfficeCollaboratorGrant,
} from "./lib/spatial-access-grants-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execute = process.argv.includes("--execute");

async function main() {
  const { rosterIndex, entry } = loadCollaboratorSelection(root);
  const unlockEmails = readUnlockAdminEmailSet(root);
  const inUnlockRoster = unlockEmails.has(entry.email);

  const { url, key } = loadSupabaseAdminEnv(
    path.resolve(root, "..", "..", "recuerda app", ".env.supabase"),
  );
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eligibility = await inspectCollaboratorEligibility(admin, entry.email);
  const effectiveAccessClass = inUnlockRoster
    ? "RECUERDA_STAFF"
    : eligibility.hasClubAccess
      ? "CLUB_MEMBER"
      : eligibility.staffRoleCount > 0
        ? "RECUERDA_STAFF"
        : eligibility.authUserId
          ? "OFFICE_COLLABORATOR"
          : null;

  const blockedReasons = [];
  if (!eligibility.authUserId) blockedReasons.push("missing_auth_user");
  if (eligibility.hasClubAccess) blockedReasons.push("has_club_access");
  if (eligibility.staffRoleCount > 0)
    blockedReasons.push("has_club_staff_role");

  const unlockWarnings = [];
  if (inUnlockRoster) {
    unlockWarnings.push("still_in_unlock_admin_emails");
  }

  let grantResult = null;
  if (execute && blockedReasons.length === 0) {
    grantResult = await upsertOfficeCollaboratorGrant(
      admin,
      eligibility.authUserId,
      null,
    );
    const after = await inspectCollaboratorEligibility(admin, entry.email);
    eligibility.activeGrantCount = after.activeGrantCount;
  }

  const summary = {
    mode: execute ? "execute" : "dry-run",
    project_ref: EXPECTED_PROJECT_REF,
    roster_index: rosterIndex,
    effective_access_class_if_connected_now: effectiveAccessClass,
    eligibility: {
      auth_user_present: Boolean(eligibility.authUserId),
      auth_user_id: eligibility.authUserId,
      club_access_active: eligibility.hasClubAccess,
      club_staff_role_count: eligibility.staffRoleCount,
      profile_linked: eligibility.profileLinked,
      active_office_collaborator_grants: eligibility.activeGrantCount,
      in_unlock_admin_emails: inUnlockRoster,
    },
    blocked_reasons: blockedReasons,
    unlock_warnings: unlockWarnings,
    grant: grantResult,
    idempotent_invariant:
      "unique partial index spatial_access_grants_active_unique on (auth_user_id, world_id, zone_key, grant_type) WHERE revoked_at IS NULL",
    next_steps: [],
  };

  if (inUnlockRoster) {
    summary.next_steps.push(
      "Remove ONLY this roster entry email from staging UNLOCK_ADMIN_EMAILS (wrangler secret) before human O6.",
    );
    summary.next_steps.push(
      "Run: node scripts/prepare-office-collaborator-unlock-removal.mjs then apply staging secret from spatial-office-collaborator-unlock-removal.local.txt",
    );
  }
  if (!execute && blockedReasons.length === 0) {
    summary.next_steps.push(
      "Re-run with --execute to create or reuse the active grant.",
    );
  }

  console.log(JSON.stringify(summary, null, 2));

  if (blockedReasons.length > 0) process.exit(2);
}

main().catch((err) => {
  console.error(JSON.stringify({ blocked: true, error: err.message }));
  process.exit(1);
});
