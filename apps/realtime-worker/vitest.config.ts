import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_ENV: "development",
          ALLOWED_ORIGIN: "https://office.test",
          TICKET_SIGNING_SECRET:
            "test-signing-secret-at-least-thirty-two-characters",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
