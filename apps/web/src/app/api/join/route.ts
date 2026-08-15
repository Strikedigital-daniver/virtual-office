import { AccessLinkRedeemInputSchema } from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

import { resolveAccessLinkEmail } from "@/lib/access-links";
import { getServerEnvironment } from "@/lib/env";
import { isSameOrigin, sha256Hex } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const GENERIC_ERROR = "El enlace no es válido, fue revocado o no pudo usarse.";

async function ensureAuthUser(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.data.user) return created.data.user.id;

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) return null;
  const existing = listed.data.users.find(
    (candidate) => candidate.email?.toLowerCase() === email,
  );
  return existing?.id ?? null;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }
  if (!getServerEnvironment()) {
    return NextResponse.json(
      { error: "El servidor de acceso no está configurado." },
      { status: 503 },
    );
  }

  const input = AccessLinkRedeemInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      { error: "Datos de acceso no válidos." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const tokenHash = await sha256Hex(input.data.token);
  const { data: link } = await admin
    .from("office_access_links")
    .select("id, email, user_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!link)
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 403 });

  const email = resolveAccessLinkEmail(link.id, link.email);
  const userId = link.user_id ?? (await ensureAuthUser(admin, email));
  if (!userId)
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 403 });

  const { data: redeemed, error: redeemError } = await admin.rpc(
    "redeem_office_access_link",
    {
      link_id: link.id,
      target_user_id: userId,
      chosen_display_name: input.data.displayName,
    },
  );
  if (redeemError || !Array.isArray(redeemed) || redeemed.length !== 1) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 403 });
  }
  const membership = redeemed[0] as { office_slug: string };

  const { data: generated, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = generated?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    console.error("Failed to mint a session for an access link", {
      code: linkError?.code,
      message: linkError?.message,
    });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 502 });
  }

  const sessionClient = await createClient();
  const { error: sessionError } = await sessionClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  if (sessionError) {
    console.error("Failed to verify a minted session token", {
      code: sessionError.code,
      message: sessionError.message,
    });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 502 });
  }

  const response = NextResponse.json({
    officeSlug: membership.office_slug,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
