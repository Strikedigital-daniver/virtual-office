import type { OfficeRoom } from "./office-room";

export interface Env {
  OFFICE_ROOMS: DurableObjectNamespace<OfficeRoom>;
  ASSETS: Fetcher;
  ALLOWED_ORIGIN: string;
  CLOUDFLARE_REALTIME_APP_ID: string;
  CLOUDFLARE_REALTIME_APP_SECRET: string;
  SPIKE_SESSION_SIGNING_SECRET: string;
  CLOUDFLARE_TURN_KEY_ID?: string;
  CLOUDFLARE_TURN_KEY_API_TOKEN?: string;
}

