#!/usr/bin/env node
/**
 * Runs a command with public env vars from wrangler.jsonc injected into process.env.
 * Used so Next.js build embeds NEXT_PUBLIC_* from the staging wrangler config.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";

const [, , wranglerEnv, app, ...command] = process.argv;

if (!wranglerEnv || !app || command.length === 0) {
  console.error(
    "Usage: node scripts/with-wrangler-env.mjs <wrangler-env> <app-dir> <command> [args...]",
  );
  process.exit(1);
}

const appDir = path.resolve(process.cwd(), app);
const config = await unstable_readConfig({
  config: path.join(appDir, "wrangler.jsonc"),
  env: wranglerEnv,
});

for (const [key, value] of Object.entries(config.vars ?? {})) {
  if (typeof value === "string") {
    process.env[key] = value;
  }
}

const result = spawnSync(command[0], command.slice(1), {
  cwd: appDir,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
