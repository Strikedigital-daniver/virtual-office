import { AccessLinkCreateInputSchema } from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

import { buildJoinUrl } from "@/lib/access-links";
import { getServerEnvironment } from "@/lib/env";
import { generateInviteToken, isSameOrigin, sha256Hex } from "@/lib/security";
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

  const input = AccessLinkCreateInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      { error: "Datos del enlace no válidos." },
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
      { error: "No tienes permiso para crear enlaces." },
      { status: 403 },
    );
  }

  const token = generateInviteToken();
  const tokenHash = await sha256Hex(token);
  const admin = createAdminClient();
  const { data: link, error: insertError } = await admin
    .from("office_access_links")
    .insert({
      office_id: input.data.officeId,
      member_label: input.data.memberLabel,
      email: input.data.email ?? null,
      role: input.data.role,
      token_hash: tokenHash,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insertError || !link) {
    console.error("Failed to persist an office access link", {
      code: insertError?.code,
      message: insertError?.message,
    });
    return NextResponse.json(
      { error: "No se pudo crear el enlace." },
      { status: 409 },
    );
  }

  const response = NextResponse.json(
    {
      linkId: link.id,
      memberLabel: input.data.memberLabel,
      url: buildJoinUrl(new URL(request.url).origin, token),
    },
    { status: 201 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
