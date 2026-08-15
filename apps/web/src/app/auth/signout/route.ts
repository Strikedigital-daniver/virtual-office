import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnvironment } from "@/lib/env";
import { isSameOrigin } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }
  if (getPublicEnvironment()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
