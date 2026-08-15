import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const outputDirectory = new URL("../dist/client/", import.meta.url);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  cp(new URL("../src/client/index.html", import.meta.url), new URL("index.html", outputDirectory)),
  cp(new URL("../src/client/styles.css", import.meta.url), new URL("styles.css", outputDirectory)),
  build({
    entryPoints: [fileURLToPath(new URL("../src/client/main.ts", import.meta.url))],
    outfile: fileURLToPath(new URL("app.js", outputDirectory)),
    bundle: true,
    format: "esm",
    platform: "browser",
    sourcemap: true,
    target: ["chrome120", "edge120", "safari17"],
    logLevel: "info",
  }),
]);
