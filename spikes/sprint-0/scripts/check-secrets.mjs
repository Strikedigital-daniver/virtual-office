import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([".git", ".wrangler", "coverage", "dist", "node_modules"]);

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

const trackedFiles = await sourceFiles();
const clientBundleFiles = await sourceFiles(path.join("dist", "client")).catch(() => []);

const forbidden = [
  /CLOUDFLARE_REALTIME_APP_SECRET[ \t]*=[ \t]*[^\s#]+/u,
  /CLOUDFLARE_TURN_KEY_API_TOKEN[ \t]*=[ \t]*[^\s#]+/u,
  /SPIKE_SESSION_SIGNING_SECRET[ \t]*=[ \t]*[^\s#]+/u,
  /Bearer\s+[A-Za-z0-9._~-]{24,}/u,
];

const findings = [];
for (const file of trackedFiles) {
  const text = await readFile(file, "utf8").catch(() => "");
  for (const pattern of forbidden) {
    if (pattern.test(text)) findings.push(`${file}: ${pattern.source}`);
  }
}

const serverOnlyIdentifiers = [
  "CLOUDFLARE_REALTIME_APP_SECRET",
  "CLOUDFLARE_TURN_KEY_API_TOKEN",
  "SPIKE_SESSION_SIGNING_SECRET",
];
for (const file of clientBundleFiles) {
  const text = await readFile(file, "utf8").catch(() => "");
  for (const identifier of serverOnlyIdentifiers) {
    if (text.includes(identifier)) findings.push(`${file}: server-only identifier ${identifier}`);
  }
}

if (findings.length > 0) {
  console.error("Potential secret material found:\n" + findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed (${trackedFiles.length} source files and ${clientBundleFiles.length} client bundle files inspected).`,
  );
}
