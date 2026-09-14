#!/usr/bin/env node
/**
 * Genera WAV/Y4M sintéticos distinguibles para Chromium fake media devices.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(root, "fixtures");

const FIXTURES = [
  {
    name: "user-a-audio.wav",
    args: [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=120",
      "-ar",
      "48000",
      "-ac",
      "1",
      path.join(fixturesDir, "user-a-audio.wav"),
    ],
  },
  {
    name: "user-b-audio.wav",
    args: [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=120",
      "-ar",
      "48000",
      "-ac",
      "1",
      path.join(fixturesDir, "user-b-audio.wav"),
    ],
  },
  {
    name: "user-a-video.y4m",
    args: [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x240:r=15:d=120",
      "-pix_fmt",
      "yuv420p",
      path.join(fixturesDir, "user-a-video.y4m"),
    ],
  },
  {
    name: "user-b-video.y4m",
    args: [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x240:r=15:d=120",
      "-pix_fmt",
      "yuv420p",
      path.join(fixturesDir, "user-b-video.y4m"),
    ],
  },
];

function main() {
  fs.mkdirSync(fixturesDir, { recursive: true });
  for (const fixture of FIXTURES) {
    const target = fixture.args.at(-1);
    if (fs.existsSync(target)) {
      console.log(`skip ${fixture.name} (exists)`);
      continue;
    }
    const result = spawnSync("ffmpeg", fixture.args, { stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`ffmpeg failed for ${fixture.name}`);
      process.exit(result.status ?? 1);
    }
    console.log(`wrote ${fixture.name}`);
  }
}

main();
