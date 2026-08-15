import { AccessLinkRevokeInputSchema } from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/lib/env";
import { isSameOrigin } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }
  if (!getServerEnvironment()) {
    return NextResponse.json(
      { error: "El servidor de enlaces no está configurado." },
      { status: 503 },
    );
  }

  const input = AccessLinkRevokeInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      { error: "Datos de revocación no válidos." },
      { status: 400 },
    );
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const { data: membership } = await userClient
    .from("office_members")
    .select("role")
    .eq("office_id", input.data.officeId)
    .eq("user_id", user.id)
    .eq("active", true)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: "No tienes permiso para revocar enlaces." },
      { status: 403 },
    );
  }

  const admin = createAdminClient();
  const { data: revoked, error: updateError } = await admin
    .from("office_access_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.data.linkId)
    .eq("office_id", input.data.officeId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (updateError || !revoked) {
    return NextResponse.json(
      { error: "El enlace no existe o ya estaba revocado." },
      { status: 409 },
    );
  }

  const response = NextResponse.json({ revokedId: revoked.id });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
