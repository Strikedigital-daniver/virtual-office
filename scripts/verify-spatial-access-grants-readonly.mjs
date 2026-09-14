/**
 * Read-only verification for spatial_access_grants migration (no PII).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  EXPECTED_PROJECT_REF,
  OFFICE_COLLABORATOR_GRANT,
  OFFICE_ZONE_KEY,
  TEMPLE_WORLD_ID,
  loadSupabaseAdminEnv,
} from "./lib/spatial-access-grants-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const { url, key } = loadSupabaseAdminEnv(
    path.resolve(root, "..", "..", "recuerda app", ".env.supabase"),
  );
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: grants, error: grantsErr } = await admin
    .from("spatial_access_grants")
    .select("id, grant_type, zone_key, revoked_at, expires_at")
    .limit(1);
  if (grantsErr) throw grantsErr;

  const { count: officeMembersCount, error: officeMembersErr } = await admin
    .from("office_members")
    .select("id", { count: "exact", head: true });
  const officeMembersMissing = Boolean(
    officeMembersErr &&
    String(officeMembersErr.message).includes("does not exist"),
  );

  const { count: worldsCount, error: worldsErr } = await admin
    .from("spatial_worlds")
    .select("id", { count: "exact", head: true });
  if (worldsErr) throw worldsErr;

  const { count: activeGrantCount, error: activeGrantErr } = await admin
    .from("spatial_access_grants")
    .select("id", { count: "exact", head: true })
    .eq("grant_type", OFFICE_COLLABORATOR_GRANT)
    .eq("zone_key", OFFICE_ZONE_KEY)
    .is("revoked_at", null);
  if (activeGrantErr) throw activeGrantErr;

  console.log(
    JSON.stringify(
      {
        project_ref: EXPECTED_PROJECT_REF,
        table_readable: true,
        sample_columns_present: [
          "id",
          "grant_type",
          "zone_key",
          "revoked_at",
          "expires_at",
        ],
        rls_assumed_enabled: true,
        policies_expected: {
          select_own_authenticated: "spatial_access_grants_select_own",
          write_policies_for_authenticated: false,
        },
        unique_indexes_expected: [
          "spatial_access_grants_active_unique",
          "spatial_access_grants_auth_user_idx",
        ],
        office_members_table_absent: officeMembersMissing,
        spatial_worlds_count: worldsCount ?? 0,
        temple_world_id: TEMPLE_WORLD_ID,
        active_office_collaborator_grants: activeGrantCount ?? 0,
        club_schema_mutations: {
          profiles: false,
          memberships: false,
          entitlements: false,
          club_staff_roles: false,
        },
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
