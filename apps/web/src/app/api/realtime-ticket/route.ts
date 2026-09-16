import {
  TEMPLE_WORLD_SLUG,
  TicketRequestSchema,
  issueRealtimeTicket,
  REALTIME_TICKET_TTL_MS,
} from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnvironment } from "@/lib/env";
import { isSameOrigin } from "@/lib/security";
import { clubSpatialEntitlementProvider } from "@/lib/spatial";
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

  if (input.data.officeSlug !== TEMPLE_WORLD_SLUG) {
    return NextResponse.json(
      { error: "Mundo no disponible." },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

  const entitlements =
    await clubSpatialEntitlementProvider.getSpatialEntitlements(supabase);
  if (!entitlements) {
    return NextResponse.json(
      { error: "Se requiere membresía activa del Recuerda Club." },
      { status: 403 },
    );
  }

  // Protocol compatibility debt: ticket claim field is officeId; value is world UUID.
  const worldId = entitlements.templeWorldId;
  const issuedAt = Date.now();
  const ticket = await issueRealtimeTicket(
    {
      userId: entitlements.authUserId,
      officeId: worldId,
      displayName: entitlements.displayName,
      accessClass: entitlements.accessClass,
    },
    signingSecret,
    issuedAt,
  );

  const httpBase = environment.realtimeWebSocketUrl.replace(/\/$/u, "");
  const wsBase = httpBase.replace(/^http/u, "ws");
  const response = NextResponse.json({
    ticket,
    issuedAt,
    expiresAt: issuedAt + REALTIME_TICKET_TTL_MS,
    url: `${wsBase}/office/${worldId}/connect`,
    mediaBaseUrl: `${httpBase}/office/${worldId}/media`,
    userId: entitlements.authUserId,
    accessClass: entitlements.accessClass,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
