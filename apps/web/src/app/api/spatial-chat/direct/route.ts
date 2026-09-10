import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isSameOrigin } from "@/lib/security";
import {
  assertDirectMessageTarget,
  requireSpatialChatContext,
  resolveAccessClassForUserId,
  resolveDisplayName,
} from "@/lib/spatial-chat/context";
import { getOrCreateDirectChannel } from "@/lib/spatial-chat/repository";

const DirectRequestSchema = z.object({
  targetUserId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Origen no permitido." },
      { status: 403 },
    );
  }

  const context = await requireSpatialChatContext();
  if (!context) {
    return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  }

  const parsed = DirectRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const targetAccessClass = await resolveAccessClassForUserId(
    parsed.data.targetUserId,
  );
  if (!targetAccessClass) {
    return NextResponse.json(
      { error: "Participante no disponible." },
      { status: 404 },
    );
  }

  const allowed = await assertDirectMessageTarget({
    context,
    targetUserId: parsed.data.targetUserId,
    targetAccessClass,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "No puedes abrir ese mensaje directo." },
      { status: 403 },
    );
  }

  try {
    const targetDisplayName = await resolveDisplayName(
      parsed.data.targetUserId,
    );
    const channel = await getOrCreateDirectChannel({
      worldId: context.templeWorldId,
      requesterUserId: context.authUserId,
      targetUserId: parsed.data.targetUserId,
      targetDisplayName,
    });
    return NextResponse.json({ channel });
  } catch {
    return NextResponse.json(
      { error: "No se pudo abrir el mensaje directo." },
      { status: 503 },
    );
  }
}
