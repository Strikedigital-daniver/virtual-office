import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { installInstrumentation } from "./instrumentation";
import { E2E_TIMING } from "./timing";

export interface OfficeSession {
  label: string;
  userId: string | null;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface SessionOptions {
  label: string;
  baseUrl: string;
  email: string;
  password: string;
  syntheticProfile: "alpha" | "beta";
}

export async function launchBrowser(): Promise<Browser> {
  const headless = process.env.VO_E2E_HEADED !== "1";
  const launchOptions = {
    headless,
    args: [
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  };
  try {
    return await chromium.launch({ ...launchOptions, channel: "chrome" });
  } catch {
    return chromium.launch(launchOptions);
  }
}

export async function createInstrumentedContext(
  browser: Browser,
  options: SessionOptions,
): Promise<OfficeSession> {
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    locale: "es-CL",
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });

  await context.grantPermissions(["camera", "microphone"], {
    origin: options.baseUrl,
  });

  const page = await context.newPage();
  await installInstrumentation(page);

  return {
    label: options.label,
    userId: null,
    browser,
    context,
    page,
  };
}

export async function loginAndEnterOffice(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  const officePath = "/office/temple";
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent(officePath)}`, {
    waitUntil: "networkidle",
  });
  const emailField = page.getByRole("textbox", { name: "Correo" });
  const passwordField = page.getByRole("textbox", { name: "Contraseña" });
  await emailField.waitFor({ state: "visible", timeout: 30_000 });
  await emailField.fill(email);
  await passwordField.fill(password);
  await expect(emailField).toHaveValue(email);
  await expect(passwordField).toHaveValue(password);
  const submit = page.getByRole("button", { name: "Entrar" });
  await submit.click();
  await page.waitForURL(`**${officePath}**`, {
    timeout: E2E_TIMING.loginRedirectMs,
    waitUntil: "domcontentloaded",
  });
  const loginError = page.locator(".error[role='alert']");
  if (await loginError.isVisible().catch(() => false)) {
    throw new Error(
      `Login falló: ${(await loginError.innerText()).trim()}`,
    );
  }
  await waitForOfficeConnected(page);
}

export async function waitForOfficeConnected(page: Page): Promise<void> {
  await page
    .locator(".office-world-status")
    .filter({ hasText: "Conectado" })
    .waitFor({ timeout: E2E_TIMING.officeConnectMs });
  await page
    .locator(".office-world-canvas canvas")
    .waitFor({ timeout: E2E_TIMING.canvasReadyMs });
}

export async function readSelfUserId(page: Page): Promise<string> {
  const userId = await page.evaluate(async () => {
    const res = await fetch("/api/realtime-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeSlug: "temple" }),
    });
    if (!res.ok) throw new Error("No se pudo leer userId QA.");
    const body = (await res.json()) as { userId?: string };
    if (!body.userId) throw new Error("Ticket sin userId.");
    return body.userId;
  });
  return userId;
}

export async function focusCanvas(page: Page): Promise<void> {
  const canvas = page.locator(".office-world-canvas canvas");
  await canvas.click({ position: { x: 200, y: 200 } });
}

export async function openDevicePanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Dispositivos/ }).click();
  await page.locator("#mic-device").waitFor({ timeout: 10_000 });
}

export async function selectSyntheticQaDevices(
  page: Page,
  profile: "alpha" | "beta",
): Promise<void> {
  const deviceId =
    profile === "alpha" ? "qa-synthetic-alpha" : "qa-synthetic-beta";
  await openDevicePanel(page);
  await page.locator("#mic-device").selectOption(deviceId);
  await page.locator("#camera-device").selectOption(deviceId);
}

export async function toggleMic(page: Page, enable: boolean): Promise<void> {
  const button = page.getByRole("button", { name: /Micrófono/ });
  const pressed = await button.getAttribute("aria-pressed");
  const isOn = pressed === "true";
  if (isOn !== enable) {
    await button.click();
    await page.waitForTimeout(800);
  }
}

export async function toggleCamera(page: Page, enable: boolean): Promise<void> {
  const button = page.getByRole("button", { name: /Cámara/ });
  const pressed = await button.getAttribute("aria-pressed");
  const isOn = pressed === "true";
  if (isOn !== enable) {
    await button.click();
    await page.waitForTimeout(800);
  }
}

export async function waitForMediaControlsReady(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Micrófono/ }).waitFor({
    state: "visible",
    timeout: E2E_TIMING.officeConnectMs,
  });
  await page.getByRole("button", { name: /Dispositivos/ }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

export async function waitForMediaReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const text =
        document.querySelector(".spatial-debug-panel")?.textContent ?? "";
      const iceConnected =
        text.includes("sendPeerConnection: connected") &&
        text.includes("iceConnectionState: connected");
      const published =
        text.includes("audioPublication: yes") &&
        text.includes("getUserMediaTrack: live");
      return iceConnected || published;
    },
    { timeout: E2E_TIMING.mediaReadyMs },
  );
}

export async function enableSyntheticMedia(
  page: Page,
  profile: "alpha" | "beta",
): Promise<void> {
  await focusCanvas(page);
  await waitForMediaControlsReady(page);
  await selectSyntheticQaDevices(page, profile);
  await toggleMic(page, false);
  await toggleCamera(page, false);
  await page.waitForTimeout(500);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await toggleMic(page, true);
    await page.waitForTimeout(2_000);
    const micPressed = await page
      .getByRole("button", { name: /Micrófono/ })
      .getAttribute("aria-pressed");
    if (micPressed === "true") break;
    if (attempt === 3) {
      const error = await page
        .locator(".media-error, .error[role='alert']")
        .first()
        .textContent()
        .catch(() => null);
      throw new Error(
        `El micrófono QA sintético no quedó encendido${error ? `: ${error.trim()}` : "."}`,
      );
    }
    await toggleMic(page, false);
    await page.waitForTimeout(500);
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await toggleCamera(page, true);
    await page.waitForTimeout(2_000);
    const cameraPressed = await page
      .getByRole("button", { name: /Cámara/ })
      .getAttribute("aria-pressed");
    if (cameraPressed !== "true") {
      await toggleCamera(page, false);
      await page.waitForTimeout(500);
      continue;
    }
    await waitForMediaReady(page);
    return;
  }
  throw new Error("La cámara QA sintética no quedó encendida.");
}

export async function waitForRemotePeer(
  page: Page,
  remoteUserId: string,
  timeoutMs = E2E_TIMING.remotePeerMs,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const visible = await page.locator(
      `.spatial-debug-panel section[data-remote-user-id="${remoteUserId}"]`,
    ).count();
    if (visible > 0) return;
    await page.waitForTimeout(1_000);
  }
  throw new Error(
    `El peer ${remoteUserId.slice(0, 8)} no apareció en diagnóstico.`,
  );
}

export async function readPeerDistancePx(
  page: Page,
  remoteUserId: string,
): Promise<{ distance: number; zone: string | null } | null> {
  const rows = await readProximityRows(page);
  const row = findProximityRowForPeer(rows, remoteUserId);
  if (row) {
    return { distance: row.distance, zone: row.zone };
  }

  return page.evaluate((peerId) => {
    const section = document.querySelector(
      `.spatial-debug-panel section[data-remote-user-id="${peerId}"]`,
    );
    if (!section) return null;
    const items = section.querySelectorAll("li");
    let distanceTiles: number | null = null;
    let zone: string | null = null;
    for (const item of items) {
      const text = item.textContent ?? "";
      if (text.includes("distanceTiles:")) {
        const raw = text.split(":")[1]?.trim() ?? "";
        const parsed = Number.parseFloat(raw);
        distanceTiles = Number.isFinite(parsed) ? parsed : null;
      }
      if (text.includes("remoteZoneId:")) {
        zone = text.split(":")[1]?.trim() ?? null;
      }
    }
    if (distanceTiles === null) return null;
    return { distance: distanceTiles * 32, zone };
  }, remoteUserId);
}

export async function readProximityRows(page: Page): Promise<
  Array<{
    remoteId: string;
    distance: number;
    zone: string;
    audioFactor: number;
    videoFactor: number;
    audioSubscribed: boolean;
    videoSubscribed: boolean;
  }>
> {
  const panel = page.locator(".proximity-debug");
  await panel.locator("summary").click().catch(() => undefined);
  const rows = panel.locator("tbody tr");
  const count = await rows.count();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const remoteId =
      (await row.getAttribute("data-remote-id")) ??
      (await row.locator("td").first().innerText()).trim();
    const cells = row.locator("td");
    const distanceRaw = (await cells.nth(1).innerText()).trim();
    const distance = Number.parseFloat(distanceRaw.replace(/[^\d.-]/gu, ""));
    if (!Number.isFinite(distance)) continue;
    const zone = (await cells.nth(2).innerText()).trim();
    const audioFactor = Number.parseFloat(
      (await cells.nth(3).innerText()).trim(),
    );
    const videoFactor = Number.parseFloat(
      (await cells.nth(4).innerText()).trim(),
    );
    const audioSubscribed = (await cells.nth(6).innerText()).trim() === "sí";
    const videoSubscribed = (await cells.nth(7).innerText()).trim() === "sí";
    out.push({
      remoteId,
      distance,
      zone,
      audioFactor,
      videoFactor,
      audioSubscribed,
      videoSubscribed,
    });
  }
  return out;
}

export function findProximityRowForPeer(
  rows: Awaited<ReturnType<typeof readProximityRows>>,
  remoteUserId: string,
) {
  return rows.find((row) => row.remoteId === remoteUserId) ?? null;
}

export async function unlockSpatialAudio(page: Page): Promise<void> {
  await focusCanvas(page);
  await page.waitForTimeout(300);
}
