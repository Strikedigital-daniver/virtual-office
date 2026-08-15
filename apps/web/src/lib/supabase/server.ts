import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requirePublicEnvironment } from "@/lib/env";

export async function createClient() {
  const environment = requirePublicEnvironment();
  const cookieStore = await cookies();

  return createServerClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. The middleware refreshes them.
          }
        },
      },
    },
  );
}
