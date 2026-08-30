import { DurableObject } from "cloudflare:workers";

import {
  ClientEventSchema,
  MAX_SPEED_PX_PER_S,
  OFFICE_MAP,
  TILE_SIZE,
  isBlockedAtPixel,
  mapPixelSize,
  spawnFor,
  spawnPixel,
  verifyRealtimeTicket,
  zoneAtPixel,
  type PlayerState,
  type ServerEvent,
} from "@virtual-office/shared";

import type { Env } from "./env";

interface ConnectionAttachment extends PlayerState {
  connectionId: string;
  joinedAt: number;
  lastMoveAt: number;
}

const OFFICE_PATH = /^\/office\/([0-9a-f-]{36})\/connect$/u;
const BOUNDS_MARGIN = TILE_SIZE / 2;
const SPEED_TOLERANCE_PX = 16;

function attachmentOf(webSocket: WebSocket): ConnectionAttachment | null {
  const value = webSocket.deserializeAttachment() as unknown;
  if (!value || typeof value !== "object") return null;
  return value as ConnectionAttachment;
}

function playerOf(attachment: ConnectionAttachment): PlayerState {
  return {
    userId: attachment.userId,
    displayName: attachment.displayName,
    x: attachment.x,
    y: attachment.y,
    direction: attachment.direction,
    moving: attachment.moving,
    zoneId: attachment.zoneId,
    lastSeq: attachment.lastSeq,
  };
}

function safeSend(webSocket: WebSocket, event: ServerEvent): void {
  try {
    webSocket.send(JSON.stringify(event));
  } catch {
    // Cleanup for vanished sockets is owned by the close/error callbacks.
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export class OfficeRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = OFFICE_PATH.exec(url.pathname);
    if (!match) {
      return errorResponse(404, "NOT_FOUND", "Unknown Durable Object route.");
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return errorResponse(
        426,
        "UPGRADE_REQUIRED",
        "Expected a WebSocket upgrade.",
      );
    }
    if (!this.env.TICKET_SIGNING_SECRET) {
      return errorResponse(
        503,
        "TICKETS_NOT_CONFIGURED",
        "The ticket signing secret is not configured.",
      );
    }

    const token = url.searchParams.get("ticket") ?? "";
    let claims;
    try {
      claims = await verifyRealtimeTicket(
        token,
        this.env.TICKET_SIGNING_SECRET,
      );
    } catch {
      return errorResponse(
        401,
        "TICKET_INVALID",
        "The connection ticket is missing, expired or invalid.",
      );
    }
    if (claims.officeId !== match[1]) {
      return errorResponse(
        403,
        "TICKET_OFFICE_MISMATCH",
        "The ticket does not belong to this office.",
      );
    }

    const duplicates = this.ctx
      .getWebSockets()
      .map((webSocket) => ({ webSocket, attachment: attachmentOf(webSocket) }))
      .filter(
        (
          entry,
        ): entry is {
          webSocket: WebSocket;
          attachment: ConnectionAttachment;
        } => entry.attachment?.userId === claims.userId,
      );
    const prior = duplicates.at(-1)?.attachment;
    const distinctUsers = new Set(
      this.ctx
        .getWebSockets()
        .map((webSocket) => attachmentOf(webSocket)?.userId)
        .filter((userId): userId is string => Boolean(userId)),
    );

    const spawn = spawnPixel(spawnFor(OFFICE_MAP, distinctUsers.size));
    const now = Date.now();
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      userId: claims.userId,
      displayName: claims.displayName,
      x: prior?.x ?? spawn.x,
      y: prior?.y ?? spawn.y,
      direction: prior?.direction ?? "down",
      moving: false,
      zoneId: prior?.zoneId ?? zoneAtPixel(OFFICE_MAP, spawn.x, spawn.y),
      lastSeq: prior?.lastSeq ?? 0,
      joinedAt: prior?.joinedAt ?? now,
      lastMoveAt: now,
    };

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    for (const duplicate of duplicates) {
      duplicate.webSocket.close(4001, "Replaced by a newer connection");
    }

    const players = this.connectedPlayers(claims.userId);
    players.push(playerOf(attachment));
    safeSend(server, {
      type: "office.snapshot",
      selfUserId: claims.userId,
      players,
      serverTime: now,
    });
    this.broadcast(
      { type: "player.joined", player: playerOf(attachment) },
      attachment.connectionId,
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    webSocket: WebSocket,
    message: ArrayBuffer | string,
  ): Promise<void> {
    if (typeof message !== "string" || message.length > 2_048) {
      safeSend(webSocket, {
        type: "error",
        code: "INVALID_EVENT",
        message: "Only bounded JSON text events are accepted.",
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message) as unknown;
    } catch {
      safeSend(webSocket, {
        type: "error",
        code: "INVALID_JSON",
        message: "The event must be valid JSON.",
      });
      return;
    }

    const result = ClientEventSchema.safeParse(parsed);
    if (!result.success) {
      safeSend(webSocket, {
        type: "error",
        code: "INVALID_EVENT",
        message: "The event does not match the presence protocol.",
      });
      return;
    }
    const data = result.data;

    const attachment = attachmentOf(webSocket);
    if (!attachment) {
      webSocket.close(1011, "Connection state unavailable");
      return;
    }

    const now = Date.now();
    if (data.type === "ping") {
      safeSend(webSocket, {
        type: "pong",
        clientTime: data.clientTime,
        serverTime: now,
      });
      return;
    }

    if (data.seq <= attachment.lastSeq) return;

    const correct = (reason: "speed" | "collision" | "bounds") => {
      const updated: ConnectionAttachment = {
        ...attachment,
        moving: false,
        lastSeq: data.seq,
        lastMoveAt: now,
      };
      webSocket.serializeAttachment(updated);
      safeSend(webSocket, {
        type: "player.corrected",
        x: attachment.x,
        y: attachment.y,
        seq: data.seq,
        reason,
      });
    };

    const { width, height } = mapPixelSize(OFFICE_MAP);
    const { x, y } = data;
    if (
      x < BOUNDS_MARGIN ||
      y < BOUNDS_MARGIN ||
      x > width - BOUNDS_MARGIN ||
      y > height - BOUNDS_MARGIN
    ) {
      correct("bounds");
      return;
    }

    const elapsedMs = Math.min(
      Math.max(now - attachment.lastMoveAt, 30),
      2_000,
    );
    const distance = Math.hypot(x - attachment.x, y - attachment.y);
    const allowed =
      (MAX_SPEED_PX_PER_S * elapsedMs) / 1_000 + SPEED_TOLERANCE_PX;
    if (distance > allowed) {
      correct("speed");
      return;
    }

    if (isBlockedAtPixel(OFFICE_MAP, x, y)) {
      correct("collision");
      return;
    }

    const updated: ConnectionAttachment = {
      ...attachment,
      x,
      y,
      direction: data.direction,
      moving: data.moving,
      zoneId: zoneAtPixel(OFFICE_MAP, x, y),
      lastSeq: data.seq,
      lastMoveAt: now,
    };
    webSocket.serializeAttachment(updated);
    this.broadcast({
      type: "player.updated",
      player: playerOf(updated),
      serverTime: now,
    });
  }

  async webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const attachment = attachmentOf(webSocket);
    webSocket.close(code, reason);
    if (
      !attachment ||
      this.hasAnotherConnection(attachment.userId, attachment.connectionId)
    ) {
      return;
    }
    this.broadcast({ type: "player.left", userId: attachment.userId });
  }

  async webSocketError(webSocket: WebSocket): Promise<void> {
    const attachment = attachmentOf(webSocket);
    if (
      !attachment ||
      this.hasAnotherConnection(attachment.userId, attachment.connectionId)
    ) {
      return;
    }
    this.broadcast({ type: "player.left", userId: attachment.userId });
  }

  private connectedPlayers(excludeUserId?: string): PlayerState[] {
    const latest = new Map<string, ConnectionAttachment>();
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (!attachment || attachment.userId === excludeUserId) continue;
      const current = latest.get(attachment.userId);
      if (!current || attachment.joinedAt >= current.joinedAt) {
        latest.set(attachment.userId, attachment);
      }
    }
    return [...latest.values()].map(playerOf);
  }

  private hasAnotherConnection(userId: string, connectionId: string): boolean {
    return this.ctx.getWebSockets().some((candidate) => {
      const attachment = attachmentOf(candidate);
      return (
        attachment?.userId === userId &&
        attachment.connectionId !== connectionId
      );
    });
  }

  private broadcast(event: ServerEvent, excludeConnectionId?: string): void {
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (attachment?.connectionId === excludeConnectionId) continue;
      safeSend(webSocket, event);
    }
  }
}
