import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spatialTestEnvironment } from "./lib/spatial-test-environment.mjs";

// Never reads application configuration or remote Supabase credentials.
const root = new URL("../", import.meta.url);
const host = process.env.SPATIAL_TEST_PGHOST ?? "127.0.0.1";
const port = process.env.SPATIAL_TEST_PGPORT ?? "55432";
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("Spatial SQL tests accept loopback PostgreSQL only.");
}
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("Invalid SPATIAL_TEST_PGPORT.");
}

const migrations = readdirSync(new URL("spatial/sql/", root))
  .filter((name) => /^\d{14}_spatial_[a-z_]+\.sql$/.test(name))
  .sort();
if (migrations.length === 0) throw new Error("No Spatial SQL files found.");
const files = [
  "spatial/tests/fixture.sql",
  ...migrations.map((name) => `spatial/sql/${name}`),
  "spatial/tests/contracts.sql",
];
const sql = [
  "BEGIN; SET LOCAL statement_timeout = '30s';",
  ...files.map((name) => readFileSync(new URL(name, root), "utf8")),
  "ROLLBACK;",
].join("\n");

console.log(
  `Testing ${migrations.length} Spatial SQL files in a disposable local database.`,
);
const result = spawnSync(
  process.env.SPATIAL_TEST_PSQL ?? "psql",
  [
    "-X",
    "--no-password",
    "--set=ON_ERROR_STOP=1",
    "--quiet",
    "--host",
    host,
    "--port",
    port,
    "--username",
    process.env.SPATIAL_TEST_PGUSER ?? "postgres",
    "--dbname",
    "spatial_contract_test",
  ],
  {
    cwd: fileURLToPath(root),
    input: sql,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    env: spatialTestEnvironment(process.env, {
      host,
      port,
      passwordFile: fileURLToPath(
        new URL("spatial/tests/no-password-file", root),
      ),
    }),
  },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(`SQL test runner: ${result.error.message}`);
}
if (result.status !== 0 || result.error) process.exit(1);
console.log("Spatial SQL contracts passed; all fixture changes rolled back.");
