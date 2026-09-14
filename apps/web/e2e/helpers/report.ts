import fs from "node:fs";
import path from "node:path";

export type ScenarioVerdict = "PASS" | "FAIL" | "BLOCKED" | "SKIP";

export interface ScenarioResult {
  id: string;
  title: string;
  directions: Array<{
    direction: string;
    medium: "audio" | "video";
    verdict: ScenarioVerdict;
    notes: string;
  }>;
  evidence: unknown[];
  hypotheses?: string;
}

export interface E2eReport {
  generatedAt: string;
  commit: string | null;
  deployedBuildId: string | null;
  baseUrl: string;
  blockedReason?: string;
  scenarios: ScenarioResult[];
  summary: {
    pass: number;
    fail: number;
    blocked: number;
    skip: number;
  };
}

export function buildSummary(
  scenarios: ScenarioResult[],
): E2eReport["summary"] {
  let pass = 0;
  let fail = 0;
  let blocked = 0;
  let skip = 0;
  for (const scenario of scenarios) {
    for (const dir of scenario.directions) {
      if (dir.verdict === "PASS") pass += 1;
      else if (dir.verdict === "FAIL") fail += 1;
      else if (dir.verdict === "BLOCKED") blocked += 1;
      else skip += 1;
    }
  }
  return { pass, fail, blocked, skip };
}

export function redactEvidence(value: unknown): unknown {
  const text = JSON.stringify(value);
  const redacted = text
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
      "[uuid]",
    )
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, "[jwt]")
    .replace(/ticket[=:]\s*["']?[^"'\s,}]+/giu, "ticket=[redacted]");
  return JSON.parse(redacted);
}

export function writeReport(
  artifactsDir: string,
  report: E2eReport,
): { jsonPath: string; markdownPath: string } {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = path.join(artifactsDir, "real-media-report.json");
  const markdownPath = path.join(artifactsDir, "real-media-report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(redactEvidence(report), null, 2));

  const lines: string[] = [
    "# Virtual Office — prueba real de medios (Playwright)",
    "",
    `- Generado: ${report.generatedAt}`,
    `- Commit probado: ${report.commit ?? "desconocido"}`,
    `- Build desplegado (/BUILD_ID): ${report.deployedBuildId ?? "desconocido"}`,
    `- Base URL: ${report.baseUrl}`,
    "",
  ];

  if (report.blockedReason) {
    lines.push(`## BLOCKED`, "", report.blockedReason, "");
  }

  lines.push(
    "## Resumen",
    "",
    `| PASS | FAIL | BLOCKED | SKIP |`,
    `| ---: | ---: | ------: | ---: |`,
    `| ${report.summary.pass} | ${report.summary.fail} | ${report.summary.blocked} | ${report.summary.skip} |`,
    "",
    "## Escenarios",
    "",
  );

  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.id}. ${scenario.title}`, "");
    for (const dir of scenario.directions) {
      lines.push(
        `- **${dir.direction} / ${dir.medium}**: ${dir.verdict} — ${dir.notes}`,
      );
    }
    if (scenario.hypotheses) {
      lines.push("", `_Hipótesis:_ ${scenario.hypotheses}`);
    }
    lines.push("");
  }

  lines.push(
    "## Evidencia",
    "",
    "Artefacto JSON redactado: `real-media-report.json`",
    "",
  );

  fs.writeFileSync(markdownPath, lines.join("\n"));
  return { jsonPath, markdownPath };
}
