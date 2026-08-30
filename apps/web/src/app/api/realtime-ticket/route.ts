import {
  TicketRequestSchema,
  issueRealtimeTicket,
} from "@virtual-office/shared";
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
  const environment = getPublicEnvironment();
  const signingSecret = process.env.REALTIME_TICKET_SIGNING_SECRET;
  if (!environment || !environment.realtimeWebSocketUrl || !signingSecret) {
    return NextResponse.json(
      { error: "El servicio de presencia no está configurado." },
      { status: 503 },
    );
  }

  const input = TicketRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const { data: office } = await supabase
    .from("offices")
    .select("id")
    .eq("slug", input.data.officeSlug)
    .maybeSingle();
  if (!office) {
    return NextResponse.json(
      { error: "No perteneces a esta oficina." },
      { status: 403 },
    );
  }
  const { data: membership } = await supabase
    .from("office_members")
    .select("role")
    .eq("office_id", office.id)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: "No perteneces a esta oficina." },
      { status: 403 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const ticket = await issueRealtimeTicket(
    {
      userId: user.id,
      officeId: office.id,
      displayName: profile?.display_name ?? "Integrante",
    },
    signingSecret,
  );

  const wsBase = environment.realtimeWebSocketUrl
    .replace(/^http/u, "ws")
    .replace(/\/$/u, "");
  const response = NextResponse.json({
    ticket,
    url: `${wsBase}/office/${office.id}/connect`,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
