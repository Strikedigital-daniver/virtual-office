import { NextResponse, type NextRequest } from "next/server";

import { isSameOrigin } from "@/lib/security";
import {
  listVisibleChannels,
  requireSpatialChatContext,
} from "@/lib/spatial-chat/context";
import { isSpatialChatEphemeral } from "@/lib/spatial-chat/ephemeral";

function sanitizeChatError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 180);
  return String(error).slice(0, 180);
}

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
    const channels = await listVisibleChannels(context);
    return NextResponse.json({
      channels,
      accessClass: context.accessClass,
      selfUserId: context.authUserId,
      ephemeral: isSpatialChatEphemeral(),
    });
  } catch (error) {
    const detail = sanitizeChatError(error);
    const missingTable =
      detail.includes("spatial_chat_channels") &&
      (detail.includes("does not exist") ||
        detail.includes("Could not find the table"));
    return NextResponse.json(
      {
        error: missingTable
          ? "Chat no configurado en Supabase (falta migración spatial_chat)."
          : "No se pudieron cargar los canales.",
        ...(process.env.NEXT_PUBLIC_APP_ENV === "staging" ? { detail } : {}),
      },
      { status: 503 },
    );
  }
}
