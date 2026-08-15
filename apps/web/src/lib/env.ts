import { AppEnvironmentSchema } from "@virtual-office/shared";
import { z } from "zod";

const PublicEnvironmentSchema = z.object({
  supabaseUrl: z.string().url(),
  supabasePublishableKey: z.string().min(20),
  realtimeWebSocketUrl: z.string().url().optional(),
  appEnvironment: AppEnvironmentSchema,
});

const ServerEnvironmentSchema = PublicEnvironmentSchema.extend({
  supabaseSecretKey: z.string().min(20),
});

export type PublicEnvironment = z.infer<typeof PublicEnvironmentSchema>;
export type ServerEnvironment = z.infer<typeof ServerEnvironmentSchema>;

function publicCandidate() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    realtimeWebSocketUrl: process.env.NEXT_PUBLIC_REALTIME_WS_URL || undefined,
    appEnvironment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  };
}

export function getPublicEnvironment(): PublicEnvironment | null {
  const result = PublicEnvironmentSchema.safeParse(publicCandidate());
  return result.success ? result.data : null;
}

export function requirePublicEnvironment(): PublicEnvironment {
  const result = PublicEnvironmentSchema.safeParse(publicCandidate());
  if (!result.success)
    throw new Error("Public Supabase configuration is incomplete");
  return result.data;
}

export function getServerEnvironment(): ServerEnvironment | null {
  const result = ServerEnvironmentSchema.safeParse({
    ...publicCandidate(),
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  });
  return result.success ? result.data : null;
}
