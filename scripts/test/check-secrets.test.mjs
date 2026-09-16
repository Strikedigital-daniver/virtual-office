import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(new URL("../check-secrets.mjs", import.meta.url));
const roots = [];
const fakeSecret = ["sb", "secret", "scanner_fixture_not_a_credential"].join(
  "_",
);
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "spatial-secret-scan-test-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
}
function scan(root) {
  return spawnSync(process.execPath, [scanner], {
    cwd: root,
    encoding: "utf8",
  });
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("spatial-secret-scan-test-"));
    rmSync(root, { recursive: true, force: true });
  }
});
test("ignored local credentials are not read as publishable source", () => {
  const root = fixture();
  writeFileSync(path.join(root, ".gitignore"), ".env.local\n");
  writeFileSync(path.join(root, ".env.local"), fakeSecret);
  writeFileSync(path.join(root, "app.ts"), "export const safe = true;");
  const result = scan(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 source files/);
});
test("untracked source secrets fail without printing their values", () => {
  const root = fixture();
  writeFileSync(path.join(root, "accidental.ts"), fakeSecret);
  const result = scan(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /accidental.ts/);
  assert.ok(!result.stderr.includes(fakeSecret));
});
test("ignored generated client assets are still scanned", () => {
  const root = fixture();
  writeFileSync(path.join(root, ".gitignore"), ".next/\n");
  const assets = path.join(root, "apps", "web", ".next", "static");
  mkdirSync(assets, { recursive: true });
  writeFileSync(
    path.join(assets, "client.js"),
    'const key = "REALTIME_TICKET_SIGNING_SECRET";',
  );
  const result = scan(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /server-only identifier/);
});
test("a tracked credential cannot hide behind an ignore rule", () => {
  const root = fixture();
  writeFileSync(path.join(root, ".env.local"), fakeSecret);
  execFileSync("git", ["add", ".env.local"], { cwd: root });
  writeFileSync(path.join(root, ".gitignore"), ".env.local\n");
  assert.equal(scan(root).status, 1);
});
