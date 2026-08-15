import { InvitationAcceptInputSchema } from "@virtual-office/shared";
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
  if (!getPublicEnvironment()) {
    return NextResponse.json(
      { error: "Supabase no está configurado." },
      { status: 503 },
    );
  }

  const input = InvitationAcceptInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      { error: "Datos de invitación no válidos." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const { data, error } = await supabase.rpc("accept_office_invitation", {
    invite_token: input.data.token,
    chosen_display_name: input.data.displayName,
  });
  if (error || !Array.isArray(data) || data.length !== 1) {
    return NextResponse.json(
      {
        error: "La invitación expiró, fue revocada o pertenece a otro correo.",
      },
      { status: 403 },
    );
  }

  const accepted = data[0] as { office_slug: string };
  const response = NextResponse.json({ officeSlug: accepted.office_slug });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
