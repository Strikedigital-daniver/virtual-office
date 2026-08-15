import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ALLOWED_ORIGIN: "https://spike.test",
          CLOUDFLARE_REALTIME_APP_ID: "test-app-id",
          CLOUDFLARE_REALTIME_APP_SECRET: "test-app-secret-not-real",
          SPIKE_SESSION_SIGNING_SECRET:
            "test-signing-secret-at-least-thirty-two-characters",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});

