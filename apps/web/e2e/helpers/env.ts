import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL =
  "https://recuerda-spatial-web-staging.somos-81e.workers.dev";

export interface E2eCredentials {
  baseUrl: string;
  userA: { email: string; password: string; label: string };
  userB: { email: string; password: string; label: string };
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function readVar(
  fileVars: Record<string, string>,
  key: string,
): string | undefined {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return fromProcess;
  const fromFile = fileVars[key]?.trim();
  return fromFile || undefined;
}

export function loadE2eCredentials(): E2eCredentials | { blocked: string } {
  const e2eDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(e2eDir, "../../.env.e2e.local");
  const fileVars = parseEnvFile(envPath);

  const baseUrl = readVar(fileVars, "VO_E2E_BASE_URL") ?? DEFAULT_BASE_URL;
  const userAEmail = readVar(fileVars, "VO_E2E_USER_A_EMAIL");
  const userAPassword = readVar(fileVars, "VO_E2E_USER_A_PASSWORD");
  const userBEmail = readVar(fileVars, "VO_E2E_USER_B_EMAIL");
  const userBPassword = readVar(fileVars, "VO_E2E_USER_B_PASSWORD");

  const missing: string[] = [];
  if (!userAEmail) missing.push("VO_E2E_USER_A_EMAIL");
  if (!userAPassword) missing.push("VO_E2E_USER_A_PASSWORD");
  if (!userBEmail) missing.push("VO_E2E_USER_B_EMAIL");
  if (!userBPassword) missing.push("VO_E2E_USER_B_PASSWORD");

  if (missing.length > 0) {
    return {
      blocked: `Faltan credenciales QA en apps/web/.env.e2e.local o variables de entorno: ${missing.join(", ")}. Copia .env.e2e.local.example y completa dos cuentas autorizadas.`,
    };
  }

  return {
    baseUrl,
    userA: {
      email: userAEmail,
      password: userAPassword,
      label: readVar(fileVars, "VO_E2E_USER_A_LABEL") ?? "user-a",
    },
    userB: {
      email: userBEmail,
      password: userBPassword,
      label: readVar(fileVars, "VO_E2E_USER_B_LABEL") ?? "user-b",
    },
  };
}
