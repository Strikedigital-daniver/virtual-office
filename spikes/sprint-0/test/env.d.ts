import type { Env } from "../src/worker/env";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}

