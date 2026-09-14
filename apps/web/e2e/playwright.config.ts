import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { E2E_TIMING } from "./helpers/timing";

const e2eRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: e2eRoot,
  testMatch: /real-media-proximity|proximity-presence\.spec\.ts/u,
  timeout: E2E_TIMING.testTimeoutMs,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "e2e/artifacts/playwright-report" },
    ],
  ],
  outputDir: "e2e/artifacts/test-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
