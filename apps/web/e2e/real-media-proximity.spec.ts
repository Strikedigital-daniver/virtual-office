import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import { loadE2eCredentials } from "./helpers/env";
import {
  collectMediaEvidence,
  collectRtpInbound,
  evaluateAudioEvidence,
  evaluateSilentAudioEvidence,
  evaluateVideoEvidence,
  type MediaEvidence,
} from "./helpers/metrics";
import { moveUntilDistance, settle } from "./helpers/movement";
import {
  FAR_MIN_DISTANCE,
  NEAR_MAX_DISTANCE,
  UNSUBSCRIBE_MIN_DISTANCE,
  VIDEO_FADE_MAX,
  VIDEO_FADE_MIN,
} from "./helpers/proximity-contract";
import {
  buildSummary,
  type ScenarioResult,
  writeReport,
} from "./helpers/report";
import { E2E_TIMING } from "./helpers/timing";
import {
  createInstrumentedContext,
  enableSyntheticMedia,
  findProximityRowForPeer,
  launchBrowser,
  loginAndEnterOffice,
  readProximityRows,
  readSelfUserId,
  unlockSpatialAudio,
  waitForRemotePeer,
  type OfficeSession,
} from "./helpers/session";

const e2eRoot = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(e2eRoot, "artifacts");

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function fetchDeployedBuildId(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/BUILD_ID`, { cache: "no-store" });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

async function measurePair(
  receiver: OfficeSession,
  remoteUserId: string,
  publisherLabel: string,
  expectedAudioHz: number,
  expectedVideoColor: "red" | "blue",
  previousRtp?: MediaEvidence["rtpInbound"],
): Promise<{
  audio: ReturnType<typeof evaluateAudioEvidence>;
  video: ReturnType<typeof evaluateVideoEvidence>;
  evidence: MediaEvidence;
  notes: { audio: string; video: string };
}> {
  const rows = await readProximityRows(receiver.page);
  const proximityRow = findProximityRowForPeer(rows, remoteUserId);
  const proximity = proximityRow
    ? {
        distance: proximityRow.distance,
        audioFactor: proximityRow.audioFactor,
        videoFactor: proximityRow.videoFactor,
        audioSubscribed: proximityRow.audioSubscribed,
        videoSubscribed: proximityRow.videoSubscribed,
        zone: proximityRow.zone,
      }
    : undefined;

  const rtpBefore = previousRtp ?? (await collectRtpInbound(receiver.page));
  await settle(E2E_TIMING.defaultSettleMs + 1_000);
  const evidence = await collectMediaEvidence(receiver.page, {
    label: receiver.label,
    remoteLabel: publisherLabel,
    remoteUserId,
    previousRtp: rtpBefore,
    proximity,
  });

  const audio = evaluateAudioEvidence(evidence, expectedAudioHz);
  const video = evaluateVideoEvidence(evidence, expectedVideoColor);

  const audioNotes = [
    `peer=${remoteUserId.slice(0, 8)}`,
    `rtpΔ=${evidence.rtpInboundDelta?.find((s) => s.kind === "audio")?.bytesReceived ?? 0}B`,
    `mixerGain=${evidence.mixerGain?.toFixed(3) ?? "—"}`,
    `peak=${evidence.audioPeakFrequencyHz ?? "—"}Hz`,
    `rms=${evidence.audioRms?.toFixed(1) ?? "—"}`,
    proximity
      ? `dist=${Math.round(proximity.distance)}px audio=${proximity.audioFactor.toFixed(2)} zone=${proximity.zone}`
      : "sin fila proximidad",
  ].join("; ");

  const frame = evidence.videoFrames.at(-1);
  const videoNotes = [
    `rtpΔ=${evidence.rtpInboundDelta?.find((s) => s.kind === "video")?.bytesReceived ?? 0}B`,
    `framesΔ=${evidence.rtpInboundDelta?.find((s) => s.kind === "video")?.framesDecoded ?? 0}`,
    frame
      ? `rgb=(${frame.dominantRgb.r},${frame.dominantRgb.g},${frame.dominantRgb.b}) ${frame.width}x${frame.height}`
      : "sin frame",
    `changed=${evidence.videoFrameChanged}`,
  ].join("; ");

  return {
    audio,
    video,
    evidence,
    notes: { audio: audioNotes, video: videoNotes },
  };
}

test.describe.serial("Virtual Office real media (staging)", () => {
  test("proximity sintética QA — audio/video bidireccional", async () => {
    const creds = loadE2eCredentials();
    const commit = gitCommit();
    const scenarios: ScenarioResult[] = [];

    if ("blocked" in creds) {
      const report = {
        generatedAt: new Date().toISOString(),
        commit,
        deployedBuildId: null,
        baseUrl: "https://recuerda-spatial-web-staging.somos-81e.workers.dev",
        blockedReason: creds.blocked,
        scenarios: [],
        summary: { pass: 0, fail: 0, blocked: 1, skip: 0 },
      };
      writeReport(artifactsDir, report);
      test.skip(true, creds.blocked);
      return;
    }

    const deployedBuildId = await fetchDeployedBuildId(creds.baseUrl);
    let reportWritten = false;
    const browserA = await launchBrowser();
    const browserB = await launchBrowser();

    const sessionA = await createInstrumentedContext(browserA, {
      label: creds.userA.label,
      baseUrl: creds.baseUrl,
      email: creds.userA.email,
      password: creds.userA.password,
      syntheticProfile: "alpha",
    });
    const sessionB = await createInstrumentedContext(browserB, {
      label: creds.userB.label,
      baseUrl: creds.baseUrl,
      email: creds.userB.email,
      password: creds.userB.password,
      syntheticProfile: "beta",
    });

    try {
      await loginAndEnterOffice(
        sessionA.page,
        creds.baseUrl,
        creds.userA.email,
        creds.userA.password,
      );
      await loginAndEnterOffice(
        sessionB.page,
        creds.baseUrl,
        creds.userB.email,
        creds.userB.password,
      );

      sessionA.userId = await readSelfUserId(sessionA.page);
      sessionB.userId = await readSelfUserId(sessionB.page);

      await enableSyntheticMedia(sessionA.page, "alpha");
      await enableSyntheticMedia(sessionB.page, "beta");
      await unlockSpatialAudio(sessionA.page);
      await unlockSpatialAudio(sessionB.page);
      await waitForRemotePeer(sessionA.page, sessionB.userId!);
      await waitForRemotePeer(sessionB.page, sessionA.userId!);
      await settle(E2E_TIMING.defaultSettleMs + 1_000);

      const closeA = await moveUntilDistance(
        sessionA.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionB.userId! },
      );
      const closeB = await moveUntilDistance(
        sessionB.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionA.userId! },
      );
      await settle(E2E_TIMING.defaultSettleMs + 2_000);

      // Escenario 1 — cercanía bidireccional.
      const s1a = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      const s1b = await measurePair(
        sessionA,
        sessionB.userId!,
        sessionB.label,
        880,
        "blue",
      );
      scenarios.push({
        id: "1",
        title: "Cerca — audio/video bidireccional (440/880 Hz, rojo/azul)",
        directions: [
          {
            direction: "A→B",
            medium: "audio",
            verdict: s1a.audio,
            notes: s1a.notes.audio,
          },
          {
            direction: "A→B",
            medium: "video",
            verdict: s1a.video,
            notes: s1a.notes.video,
          },
          {
            direction: "B→A",
            medium: "audio",
            verdict: s1b.audio,
            notes: s1b.notes.audio,
          },
          {
            direction: "B→A",
            medium: "video",
            verdict: s1b.video,
            notes: s1b.notes.video,
          },
        ],
        evidence: [s1a.evidence, s1b.evidence],
        hypotheses: `dist A=${Math.round(closeA.distance)} B=${Math.round(closeB.distance)} reached=${closeA.reached && closeB.reached}`,
      });

      // Escenario 2a — video en banda FADE (audio sigue ON por corte duro).
      await moveUntilDistance(
        sessionA.page,
        { min: VIDEO_FADE_MIN, max: VIDEO_FADE_MAX },
        { remoteUserId: sessionB.userId! },
      );
      await moveUntilDistance(
        sessionB.page,
        { min: VIDEO_FADE_MIN, max: VIDEO_FADE_MAX },
        { remoteUserId: sessionA.userId! },
      );
      await settle(E2E_TIMING.defaultSettleMs + 1_000);
      const fadeA = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      const fadeRow = findProximityRowForPeer(
        await readProximityRows(sessionB.page),
        sessionA.userId!,
      );
      scenarios.push({
        id: "2a",
        title: "Banda video FADE — audio ON, video atenuado",
        directions: [
          {
            direction: "A→B",
            medium: "audio",
            verdict: fadeA.audio,
            notes: fadeA.notes.audio,
          },
          {
            direction: "A→B",
            medium: "video",
            verdict:
              fadeRow &&
              fadeRow.videoFactor > 0.05 &&
              fadeRow.videoFactor < 0.95
                ? "PASS"
                : "FAIL",
            notes: `videoFactor=${fadeRow?.videoFactor.toFixed(2) ?? "—"} ${fadeA.notes.video}`,
          },
        ],
        evidence: [fadeA.evidence],
      });

      // Escenario 2b — fuera del corte duro de audio.
      await moveUntilDistance(
        sessionA.page,
        { min: FAR_MIN_DISTANCE },
        { remoteUserId: sessionB.userId! },
      );
      await moveUntilDistance(
        sessionB.page,
        { min: FAR_MIN_DISTANCE },
        { remoteUserId: sessionA.userId! },
      );
      await settle(E2E_TIMING.defaultSettleMs + 1_000);
      const farA = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      const farRow = findProximityRowForPeer(
        await readProximityRows(sessionB.page),
        sessionA.userId!,
      );
      const silent = evaluateSilentAudioEvidence(farA.evidence);
      scenarios.push({
        id: "2b",
        title: "Fuera del radio de audio — silencio por gain=0",
        directions: [
          {
            direction: "A→B",
            medium: "audio",
            verdict:
              silent === "PASS" &&
              (farRow?.audioFactor ?? 1) <= 0.05 &&
              (farRow?.audioSubscribed ?? false)
                ? "PASS"
                : silent,
            notes: `factor=${farRow?.audioFactor.toFixed(2) ?? "—"} sub=${farRow?.audioSubscribed ?? "—"} ${farA.notes.audio}`,
          },
        ],
        evidence: [farA.evidence],
      });

      // Escenario 3 — unsubscribe tras demora fuera de radio extendido.
      await moveUntilDistance(
        sessionA.page,
        { min: UNSUBSCRIBE_MIN_DISTANCE },
        { remoteUserId: sessionB.userId! },
      );
      await moveUntilDistance(
        sessionB.page,
        { min: UNSUBSCRIBE_MIN_DISTANCE },
        { remoteUserId: sessionA.userId! },
      );
      await settle(E2E_TIMING.unsubscribeSettleMs);
      const unsubRow = findProximityRowForPeer(
        await readProximityRows(sessionB.page),
        sessionA.userId!,
      );
      const unsubA = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      scenarios.push({
        id: "3",
        title: "Lejos + quietos — cierre de suscripción tras demora",
        directions: [
          {
            direction: "A→B",
            medium: "audio",
            verdict: unsubRow && !unsubRow.audioSubscribed ? "PASS" : "FAIL",
            notes: `audioSub=${unsubRow?.audioSubscribed ?? "—"} dist=${unsubRow?.distance ?? "—"} ${unsubA.notes.audio}`,
          },
          {
            direction: "A→B",
            medium: "video",
            verdict: unsubRow && !unsubRow.videoSubscribed ? "PASS" : "FAIL",
            notes: `videoSub=${unsubRow?.videoSubscribed ?? "—"}`,
          },
        ],
        evidence: [unsubA.evidence],
      });

      // Escenario 4 — re-acercar (×1 dentro del presupuesto de 5 min).
      const recoveryResults: ScenarioResult["directions"] = [];
      const recoveryEvidence: MediaEvidence[] = [];
      for (
        let attempt = 1;
        attempt <= E2E_TIMING.recoveryAttempts;
        attempt += 1
      ) {
        await moveUntilDistance(
          sessionA.page,
          { max: NEAR_MAX_DISTANCE },
          { remoteUserId: sessionB.userId! },
        );
        await moveUntilDistance(
          sessionB.page,
          { max: NEAR_MAX_DISTANCE },
          { remoteUserId: sessionA.userId! },
        );
        await settle(E2E_TIMING.defaultSettleMs + 1_500);
        const recA = await measurePair(
          sessionB,
          sessionA.userId!,
          sessionA.label,
          440,
          "red",
        );
        const recB = await measurePair(
          sessionA,
          sessionB.userId!,
          sessionB.label,
          880,
          "blue",
        );
        recoveryResults.push(
          {
            direction: `A→B#${attempt}`,
            medium: "audio",
            verdict: recA.audio,
            notes: recA.notes.audio,
          },
          {
            direction: `B→A#${attempt}`,
            medium: "audio",
            verdict: recB.audio,
            notes: recB.notes.audio,
          },
        );
        recoveryEvidence.push(recA.evidence, recB.evidence);
        if (attempt < E2E_TIMING.recoveryAttempts) {
          await moveUntilDistance(
            sessionA.page,
            { min: FAR_MIN_DISTANCE },
            { remoteUserId: sessionB.userId! },
          );
          await moveUntilDistance(
            sessionB.page,
            { min: FAR_MIN_DISTANCE },
            { remoteUserId: sessionA.userId! },
          );
          await settle(E2E_TIMING.defaultSettleMs + 2_000);
        }
      }
      scenarios.push({
        id: "4",
        title: `Re-acercar — recuperación de audio (×${E2E_TIMING.recoveryAttempts})`,
        directions: recoveryResults,
        evidence: recoveryEvidence,
      });

      // Escenario 5 — toggle mic/cámara.
      await moveUntilDistance(
        sessionA.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionB.userId! },
      );
      await moveUntilDistance(
        sessionB.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionA.userId! },
      );
      await sessionA.page.getByRole("button", { name: /Micrófono/ }).click();
      await sessionA.page.getByRole("button", { name: /Cámara/ }).click();
      await settle(E2E_TIMING.defaultSettleMs + 500);
      const offA = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      await enableSyntheticMedia(sessionA.page, "alpha");
      await settle(E2E_TIMING.defaultSettleMs + 1_500);
      const onA = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      scenarios.push({
        id: "5",
        title: "Apagar/encender mic y cámara de A (sintéticos)",
        directions: [
          {
            direction: "A→B",
            medium: "audio",
            verdict:
              offA.audio === "FAIL" && onA.audio === "PASS" ? "PASS" : "FAIL",
            notes: `off=${offA.audio} on=${onA.audio}`,
          },
          {
            direction: "A→B",
            medium: "video",
            verdict:
              offA.video === "FAIL" && onA.video === "PASS" ? "PASS" : "FAIL",
            notes: `off=${offA.video} on=${onA.video}`,
          },
        ],
        evidence: [offA.evidence, onA.evidence],
      });

      // Escenario 6 — fogata omitido para colaboradores fuera de zona.
      scenarios.push({
        id: "6",
        title: "Fogata broadcast (omitido OFFICE_COLLABORATOR)",
        directions: [
          {
            direction: "n/a",
            medium: "audio",
            verdict: "SKIP",
            notes:
              "Escenario fuera de zona office; no aplica a cuentas QA colaboradoras.",
          },
        ],
        evidence: [],
      });

      // Escenario 7 — autoplay unlock en B.
      await moveUntilDistance(
        sessionA.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionB.userId! },
      );
      await moveUntilDistance(
        sessionB.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionA.userId! },
      );
      await sessionB.page.reload({ waitUntil: "domcontentloaded" });
      await sessionB.page
        .locator(".office-world-status")
        .filter({ hasText: "Conectado" })
        .waitFor({ timeout: E2E_TIMING.reloadConnectMs });
      await enableSyntheticMedia(sessionB.page, "beta");
      await settle(E2E_TIMING.defaultSettleMs + 1_000);
      const blockedPlayback = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      await unlockSpatialAudio(sessionB.page);
      await settle(E2E_TIMING.defaultSettleMs + 500);
      const recoveredPlayback = await measurePair(
        sessionB,
        sessionA.userId!,
        sessionA.label,
        440,
        "red",
      );
      scenarios.push({
        id: "7",
        title: "Recarga B — recuperación por gesto en canvas",
        directions: [
          {
            direction: "A→B",
            medium: "audio",
            verdict:
              recoveredPlayback.audio === "PASS"
                ? "PASS"
                : recoveredPlayback.audio,
            notes: `pre=${blockedPlayback.notes.audio}; post=${recoveredPlayback.notes.audio}`,
          },
        ],
        evidence: [blockedPlayback.evidence, recoveredPlayback.evidence],
      });

      const report = {
        generatedAt: new Date().toISOString(),
        commit,
        deployedBuildId,
        baseUrl: creds.baseUrl,
        scenarios,
        summary: buildSummary(scenarios),
      };
      const paths = writeReport(artifactsDir, report);
      reportWritten = true;
      fs.writeFileSync(
        path.join(artifactsDir, "latest-run.txt"),
        `${paths.markdownPath}\n`,
      );

      const failures = scenarios.flatMap((s) =>
        s.directions.filter((d) => d.verdict === "FAIL"),
      );
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} sentido(s) FAIL. Ver ${paths.markdownPath}`,
        );
      }
    } finally {
      if (!reportWritten) {
        const blockedReason =
          scenarios.length > 0
            ? "Suite interrumpida (timeout u error) antes de completar todos los escenarios."
            : "Timeout 5 min sin escenarios: ICE/SFU no conectó (sendPeerConnection permanece en new; mic/cámara sintéticos no publicaron).";
        const partialReport = {
          generatedAt: new Date().toISOString(),
          commit,
          deployedBuildId: await fetchDeployedBuildId(creds.baseUrl),
          baseUrl: creds.baseUrl,
          blockedReason,
          scenarios,
          summary: buildSummary(scenarios),
        };
        const paths = writeReport(artifactsDir, partialReport);
        fs.writeFileSync(
          path.join(artifactsDir, "latest-run.txt"),
          `${paths.markdownPath}\n`,
        );
      }
      await sessionA.context.close().catch(() => undefined);
      await sessionB.context.close().catch(() => undefined);
      await browserA.close().catch(() => undefined);
      await browserB.close().catch(() => undefined);
    }
  });
});
