import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnvironment } from "@/lib/env";
import { safeSameOriginRedirect } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const allowedTypes = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") as EmailOtpType | null;
  const nextPath = safeSameOriginRedirect(
    url.searchParams.get("next"),
    url.origin,
  );

  if (
    !getPublicEnvironment() ||
    !tokenHash ||
    !rawType ||
    !allowedTypes.has(rawType)
  ) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_confirmation", url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });
  const response = NextResponse.redirect(
    new URL(error ? "/login?error=expired_link" : nextPath, url.origin),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
