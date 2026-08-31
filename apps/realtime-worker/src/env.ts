export interface Env {
  APP_ENV: "development" | "staging" | "production";
  ALLOWED_ORIGIN?: string;
  TICKET_SIGNING_SECRET?: string;
  CLOUDFLARE_REALTIME_APP_ID?: string;
  CLOUDFLARE_REALTIME_APP_SECRET?: string;
  OFFICE_ROOM: DurableObjectNamespace;
}
