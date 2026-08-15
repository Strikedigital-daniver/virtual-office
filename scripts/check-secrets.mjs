import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".open-next",
  ".supabase",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);

async function sourceFiles(directory = ".") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const source = await sourceFiles();
const generatedClientRoots = [
  path.join("apps", "web", ".next", "static"),
  path.join("apps", "web", ".open-next", "assets"),
  path.join("spikes", "sprint-0", "dist", "client"),
];
const generatedClientFiles = (
  await Promise.all(
    generatedClientRoots.map((root) => sourceFiles(root).catch(() => [])),
  )
).flat();

const forbiddenAssignments = [
  /(?:SUPABASE_SECRET_KEY|REALTIME_WORKER_SHARED_SECRET|TICKET_SIGNING_SECRET|CLOUDFLARE_REALTIME_APP_SECRET|CLOUDFLARE_TURN_KEY_API_TOKEN|SPIKE_SESSION_SIGNING_SECRET)[ \t]*=[ \t]*[^\s#]+/u,
  /Bearer\s+[A-Za-z0-9._~-]{24,}/u,
  /sb_secret_[A-Za-z0-9_-]+/u,
];
const serverOnlyIdentifiers = [
  "SUPABASE_SECRET_KEY",
  "REALTIME_WORKER_SHARED_SECRET",
  "CLOUDFLARE_REALTIME_APP_SECRET",
  "CLOUDFLARE_TURN_KEY_API_TOKEN",
  "SPIKE_SESSION_SIGNING_SECRET",
];

const findings = [];
for (const file of source) {
  const contents = await readFile(file, "utf8").catch(() => "");
  for (const pattern of forbiddenAssignments) {
    if (pattern.test(contents)) findings.push(`${file}: ${pattern.source}`);
  }
}

for (const file of generatedClientFiles) {
  const contents = await readFile(file, "utf8").catch(() => "");
  for (const identifier of serverOnlyIdentifiers) {
    if (contents.includes(identifier))
      findings.push(`${file}: server-only identifier ${identifier}`);
  }
}

if (findings.length > 0) {
  console.error(`Potential secret material found:\n${findings.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed (${source.length} source files and ${generatedClientFiles.length} generated client files inspected).`,
  );
}
