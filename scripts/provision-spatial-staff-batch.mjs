/**
 * STAGING-ONLY batch staff Auth provisioning (identity-only).
 *
 * Default: dry-run (no writes). Real provisioning requires:
 *   node scripts/provision-spatial-staff-batch.mjs --execute
 *
 * Roster (gitignored, pick one):
 *   spatial-staff-provision.local.json   (preferred, 4–5 people)
 *   .env.spatial-staff-provision           (legacy single-user)
 *
 * Optional after execute:
 *   --write-unlock-roster → spatial-staff-unlock-admin-emails.local.txt
 *   (gitignored; for owner wrangler secret put paste only — never commit)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  loadStaffRoster,
  loadSupabaseAdminEnv,
  provisionStaffEntry,
  summarizeResults,
  writeUnlockRosterFile,
} from "./lib/spatial-staff-provision-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const writeUnlockRoster = args.has("--write-unlock-roster");

async function main() {
  const roster = loadStaffRoster(root);
  const { url, key } = loadSupabaseAdminEnv(
    path.resolve(root, "..", "..", "recuerda app", ".env.supabase"),
  );
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results = [];
  for (const entry of roster) {
    results.push(await provisionStaffEntry(admin, entry, { execute }));
  }

  const summary = summarizeResults(results, { execute });
  console.log(JSON.stringify(summary, null, 2));

  if (writeUnlockRoster && execute) {
    const outPath = writeUnlockRosterFile(root, roster);
    console.log(
      JSON.stringify(
        {
          unlock_roster_file: path.basename(outPath),
          unlock_roster_count: roster.filter((e) => e.valid).length,
          note: "Gitignored local file for owner wrangler secret paste only.",
        },
        null,
        2,
      ),
    );
  }

  const blocked = results.some((r) => r.status.startsWith("BLOCKED_"));
  if (blocked) process.exit(2);
  if (!execute) {
    console.log(
      JSON.stringify(
        {
          next_step:
            "Fill roster, review dry-run, then rerun with --execute when owner says EXECUTE STAFF BATCH.",
        },
        null,
        2,
      ),
    );
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        blocked: true,
        error: err instanceof Error ? err.message : String(err),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
