import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnvironment } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = safeRedirectPath(url.searchParams.get("next"));
  if (!getPublicEnvironment() || !code) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_callback", url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const response = NextResponse.redirect(
    new URL(error ? "/login?error=expired_link" : nextPath, url.origin),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
