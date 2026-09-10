import { parseAvatarAppearance } from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";

import { avatarWriteIsForbidden } from "@/lib/avatar/access";
import {
  loadAvatarAppearance,
  saveAvatarAppearance,
} from "@/lib/avatar/repository";
import { isSameOrigin } from "@/lib/security";
import { requireSpatialChatContext } from "@/lib/spatial-chat/context";

export async function GET(request: NextRequest) {
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
  try {
    const loaded = await loadAvatarAppearance(context.authUserId);
    return NextResponse.json({
      appearance: loaded.appearance,
      hasLoadout: loaded.hasLoadout,
      source: loaded.hasLoadout ? "server" : "empty",
      authUserId: context.authUserId,
    });
  } catch {
    return NextResponse.json(
      {
        error: "No se pudo leer el avatar en el servidor.",
        available: false,
      },
      { status: 503 },
    );
  }
}

export async function PUT(request: NextRequest) {
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
  const body = (await request.json().catch(() => null)) as {
    appearance?: unknown;
    authUserId?: unknown;
  } | null;
  if (avatarWriteIsForbidden(context.authUserId, body?.authUserId)) {
    return NextResponse.json(
      { error: "No puedes guardar el avatar de otra persona." },
      { status: 403 },
    );
  }
  const parsed = parseAvatarAppearance(body?.appearance);
  if (!parsed) {
    return NextResponse.json(
      { error: "Apariencia no válida." },
      { status: 400 },
    );
  }
  try {
    const appearance = await saveAvatarAppearance({
      authUserId: context.authUserId,
      appearance: parsed,
    });
    return NextResponse.json({ appearance, persisted: true });
  } catch {
    return NextResponse.json(
      {
        error: "No se pudo persistir el avatar en el servidor.",
        persisted: false,
      },
      { status: 503 },
    );
  }
}
