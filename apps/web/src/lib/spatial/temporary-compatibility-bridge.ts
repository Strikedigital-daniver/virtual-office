import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * TEMPORARY_COMPATIBILITY_BRIDGE
 *
 * Recuerda Club staff/admin authority for Spatial before authenticated
 * session reads against `club_staff_roles` are available (table RLS is
 * `club_staff_roles_deny_client` today).
 *
 * Canonical source in recuerda-app:
 *   apps/web/src/lib/unlock-admin-emails.ts → isUnlockAdminEmail()
 *   apps/web/src/lib/club-access.ts → userHasClubAccess()
 *
 * Spatial reuses the same runtime env contract:
 *   UNLOCK_ADMIN_EMAILS=comma,separated,emails
 *
 * Configure the web Worker with the same allowlist recuerda-app uses
 * (including any emails beyond recuerda's built-in defaults).
 *
 * Future: populate club_staff_roles + session-readable staff check → remove.
 */
const DEFAULT_UNLOCK_ADMIN_EMAILS = ["low.end.musica@gmail.com"] as const;

function readUnlockAdminEmailsFromRuntime(): string {
  try {
    const fromWorker = (
      getCloudflareContext({ async: false }).env as {
        UNLOCK_ADMIN_EMAILS?: string;
      }
    ).UNLOCK_ADMIN_EMAILS;
    if (typeof fromWorker === "string" && fromWorker.trim()) {
      return fromWorker;
    }
  } catch {
    // Local dev / tests outside the Cloudflare worker.
  }

  const fromProcess = process.env["UNLOCK_ADMIN_EMAILS"];
  return typeof fromProcess === "string" ? fromProcess : "";
}

function unlockAdminEmails(): string[] {
  const fromEnv = readUnlockAdminEmailsFromRuntime()
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return [
    ...new Set([
      ...DEFAULT_UNLOCK_ADMIN_EMAILS.map((email) => email.toLowerCase()),
      ...fromEnv,
    ]),
  ];
}

export function isRecuerdaStaffAdminViaCompatibilityBridge(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return unlockAdminEmails().includes(email.trim().toLowerCase());
}
