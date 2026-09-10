import {
  isValidChatBody,
  normalizeChatBody,
  SPATIAL_CHAT_MAX_BODY_LENGTH,
} from "@virtual-office/shared";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { isSameOrigin } from "@/lib/security";
import { fanOutSpatialChatMessage } from "@/lib/spatial-chat/fanout";
import {
  requireAccessibleChannel,
  requireSpatialChatContext,
  resolveDisplayName,
} from "@/lib/spatial-chat/context";
import {
  channelMemberUserIds,
  insertChannelMessage,
  listChannelMessages,
} from "@/lib/spatial-chat/repository";

const PostMessageSchema = z.object({
  channelId: z.string().uuid(),
  body: z.string(),
  clientMessageId: z.string().min(8).max(64).optional(),
});

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

  const channelId = request.nextUrl.searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "Canal requerido." }, { status: 400 });
  }

  const channel = await requireAccessibleChannel(context, channelId);
  if (!channel) {
    return NextResponse.json(
      { error: "Canal no disponible." },
      { status: 404 },
    );
  }

  const cursorCreatedAt =
    request.nextUrl.searchParams.get("cursorCreatedAt") ?? undefined;
  const cursorId = request.nextUrl.searchParams.get("cursorId") ?? undefined;

  try {
    const page = await listChannelMessages({
      channelId,
      ...(cursorCreatedAt && cursorId ? { cursorCreatedAt, cursorId } : {}),
      displayNameFor: resolveDisplayName,
    });
    const response = NextResponse.json(page);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "No se pudo cargar el historial." },
      { status: 503 },
    );
  }
}

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

  const parsed = PostMessageSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const body = normalizeChatBody(parsed.data.body);
  if (!isValidChatBody(body)) {
    if (!body) {
      return NextResponse.json(
        { error: "El mensaje no puede estar vacío." },
        { status: 400 },
      );
    }
    if (body.length > SPATIAL_CHAT_MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: "El mensaje es demasiado largo." },
        { status: 400 },
      );
    }
  }

  const channel = await requireAccessibleChannel(
    context,
    parsed.data.channelId,
  );
  if (!channel) {
    return NextResponse.json(
      { error: "Canal no disponible." },
      { status: 404 },
    );
  }

  try {
    const message = await insertChannelMessage({
      channelId: channel.channelId,
      authorUserId: context.authUserId,
      authorDisplayName: context.displayName,
      body,
      ...(parsed.data.clientMessageId
        ? { clientMessageId: parsed.data.clientMessageId }
        : {}),
    });

    const fanOutOk = await fanOutSpatialChatMessage(context.templeWorldId, {
      type: "chat.message.created",
      messageId: message.messageId,
      channelId: message.channelId,
      channelKind: channel.channelKind,
      authorUserId: message.authorUserId,
      displayName: message.displayName,
      body: message.body,
      createdAt: message.createdAt,
      ...(channel.channelKind === "DIRECT"
        ? (() => {
            const memberUserIds = channelMemberUserIds(channel);
            return memberUserIds ? { memberUserIds } : {};
          })()
        : {}),
    });

    if (!fanOutOk) {
      return NextResponse.json(
        {
          message,
          warning: "Mensaje guardado, pero el envío en tiempo real falló.",
        },
        { status: 202 },
      );
    }

    return NextResponse.json({ message });
  } catch {
    return NextResponse.json(
      { error: "No se pudo enviar el mensaje." },
      { status: 503 },
    );
  }
}
