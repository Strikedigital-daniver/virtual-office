import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";

import { POST as postUsers } from "@/app/api/admin/users/route";
import {
  LEGACY_OFFICE_DISABLED_MESSAGE,
  LEGACY_OFFICE_PROVISIONING_DISABLED,
} from "@/lib/legacy-office-provisioning";
import {
  getCanonicalPasswordRecoveryUrl,
  getRecuerdaAppUrl,
} from "@/lib/recuerda-auth-url";
import { ClubSpatialEntitlementProvider } from "@/lib/spatial/club-spatial-entitlement-provider";

const CANONICAL_RECOVERY_URL =
  "https://recuerda-app-alpha.vercel.app/recuperar";

describe("canonical Recuerda password recovery", () => {
  it("A. exposes the canonical recovery URL from NEXT_PUBLIC_RECUERDA_APP_URL", () => {
    process.env.NEXT_PUBLIC_RECUERDA_APP_URL =
      "https://recuerda-app-alpha.vercel.app";
    expect(getRecuerdaAppUrl()).toBe("https://recuerda-app-alpha.vercel.app");
    expect(getCanonicalPasswordRecoveryUrl()).toBe(CANONICAL_RECOVERY_URL);
  });

  it("B. derives /recuperar from a configured Recuerda app origin", () => {
    process.env.NEXT_PUBLIC_RECUERDA_APP_URL =
      "https://recuerda-app-alpha.vercel.app/";
    expect(getCanonicalPasswordRecoveryUrl()).toBe(CANONICAL_RECOVERY_URL);
  });

  it("C. documents the compatibility redirect target for /login/recuperar", () => {
    expect(getCanonicalPasswordRecoveryUrl()).toBe(CANONICAL_RECOVERY_URL);
  });

  it("D. keeps resetPasswordForEmail out of reachable Spatial recovery code", () => {
    const srcRoot = join(process.cwd(), "src");
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/u.test(entry)) continue;
        const content = readFileSync(fullPath, "utf8");
        if (content.includes("resetPasswordForEmail")) {
          offenders.push(fullPath);
        }
      }
    }

    walk(srcRoot);
    expect(offenders).toEqual([]);
  });

  it("E. keeps Spatial recovery forms removed from src", () => {
    const removed = [
      "src/components/forgot-password-form.tsx",
      "src/components/update-password-form.tsx",
      "src/lib/password-recovery.ts",
      "src/app/auth/update-password/page.tsx",
    ];
    for (const relativePath of removed) {
      expect(() =>
        readFileSync(join(process.cwd(), relativePath), "utf8"),
      ).toThrow();
    }
  });
});

describe("canonical recovery does not change Spatial entitlements", () => {
  it("G. keeps the entitlement provider importable and unchanged in scope", () => {
    expect(new ClubSpatialEntitlementProvider()).toBeInstanceOf(
      ClubSpatialEntitlementProvider,
    );
  });
});

describe("canonical recovery keeps legacy provisioning blocked", () => {
  it("F. still returns 410 for legacy admin provisioning", async () => {
    expect(LEGACY_OFFICE_PROVISIONING_DISABLED).toBe(true);
    const response = await postUsers(
      new Request("https://office.test/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://office.test",
        },
        body: JSON.stringify({
          officeId: "f69a7f7e-1e3d-45ef-a4e9-2a4512f0ca20",
          username: "testuser",
          password: "password123",
          role: "member",
        }),
      }) as NextRequest,
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: LEGACY_OFFICE_DISABLED_MESSAGE,
    });
  });
});
