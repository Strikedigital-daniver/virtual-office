import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/lib/env";

export function createAdminClient() {
  const environment = getServerEnvironment();
  if (!environment)
    throw new Error("Server-side Supabase configuration is incomplete");

  return createClient(environment.supabaseUrl, environment.supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
