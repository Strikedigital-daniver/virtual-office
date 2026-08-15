import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getPublicEnvironment } from "@/lib/env";

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  const environment = getPublicEnvironment();
  let response = NextResponse.next({ request });
  if (!environment) return response;

  const supabase = createServerClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet)
            request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
