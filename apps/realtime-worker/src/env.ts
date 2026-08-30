export interface Env {
  APP_ENV: "development" | "staging" | "production";
  ALLOWED_ORIGIN?: string;
  TICKET_SIGNING_SECRET?: string;
  OFFICE_ROOM: DurableObjectNamespace;
}
