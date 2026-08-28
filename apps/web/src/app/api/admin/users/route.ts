import { UserCreateInputSchema } from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/lib/env";
import { isSameOrigin } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/usernames";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }
  if (!getServerEnvironment()) {
    return NextResponse.json(
      { error: "El servidor no está configurado." },
      { status: 503 },
    );
  }

  const input = UserCreateInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      {
        error:
          "Datos no válidos. Usuario: 2-20 letras o números. Contraseña: mínimo 8 caracteres.",
      },
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
      { error: "No tienes permiso para crear usuarios." },
      { status: 403 },
    );
  }

  const email = usernameToEmail(input.data.username);
  if (!email) {
    return NextResponse.json(
      { error: "Nombre de usuario no válido." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password: input.data.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    const duplicated =
      created.error?.code === "email_exists" || created.error?.status === 422;
    return NextResponse.json(
      {
        error: duplicated
          ? "Ese nombre de usuario ya existe."
          : "No se pudo crear el usuario.",
      },
      { status: duplicated ? 409 : 502 },
    );
  }
  const newUserId = created.data.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    id: newUserId,
    display_name: input.data.username,
  });
  const { error: memberError } = await admin.from("office_members").upsert({
    office_id: input.data.officeId,
    user_id: newUserId,
    role: input.data.role,
    active: true,
  });
  if (profileError || memberError) {
    console.error("Failed to register a created user", {
      profile: profileError?.message,
      member: memberError?.message,
    });
    return NextResponse.json(
      { error: "El usuario se creó pero la membresía falló. Reintenta." },
      { status: 502 },
    );
  }

  const response = NextResponse.json(
    { username: input.data.username },
    { status: 201 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
