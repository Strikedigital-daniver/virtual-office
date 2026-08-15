import { InvitationCreateInputSchema } from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

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
      { error: "El servidor de invitaciones no está configurado." },
      { status: 503 },
    );
  }

  const input = InvitationCreateInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      { error: "Datos de invitación no válidos." },
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
      { error: "No tienes permiso para invitar." },
      { status: 403 },
    );
  }

  const token = generateInviteToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + input.data.expiresInHours * 60 * 60 * 1000,
  ).toISOString();
  const admin = createAdminClient();
  const { data: invitation, error: insertError } = await admin
    .from("office_invitations")
    .insert({
      office_id: input.data.officeId,
      email: input.data.email,
      role: input.data.role,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (insertError || !invitation) {
    console.error("Failed to persist an office invitation", {
      code: insertError?.code,
      message: insertError?.message,
    });
    return NextResponse.json(
      { error: "No se pudo registrar la invitación." },
      { status: 409 },
    );
  }

  const redirectTo = `${new URL(request.url).origin}/invite/${token}`;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    input.data.email,
    {
      redirectTo,
      data: { office_id: input.data.officeId, invitation_id: invitation.id },
    },
  );
  if (inviteError) {
    console.error("Supabase failed to deliver an office invitation", {
      code: inviteError.code,
      message: inviteError.message,
    });
    await admin
      .from("office_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", invitation.id);
    return NextResponse.json(
      {
        error:
          "Supabase no pudo enviar la invitación. Revisa si el correo ya está registrado.",
      },
      { status: 502 },
    );
  }

  const response = NextResponse.json(
    { invitationId: invitation.id, email: input.data.email, expiresAt },
    { status: 201 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
