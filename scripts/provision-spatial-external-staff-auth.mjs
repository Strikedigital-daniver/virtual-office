/**
 * Legacy single-user entrypoint — delegates to batch provisioner (dry-run default).
 * Prefer: scripts/provision-spatial-staff-batch.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const batchScript = path.join(
  root,
  "scripts",
  "provision-spatial-staff-batch.mjs",
);
const forwarded = process.argv.slice(2);
const result = spawnSync(process.execPath, [batchScript, ...forwarded], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
