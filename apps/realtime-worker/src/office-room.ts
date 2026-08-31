import { DurableObject } from "cloudflare:workers";

import {
  ClientEventSchema,
  CloseTracksRequestSchema,
  MAX_SPEED_PX_PER_S,
  OFFICE_MAP,
  PublishTracksRequestSchema,
  RealtimeResponseSchema,
  RenegotiateRequestSchema,
  SubscribeTracksRequestSchema,
  TILE_SIZE,
  isBlockedAtPixel,
  mapPixelSize,
  spawnFor,
  spawnPixel,
  verifyRealtimeTicket,
  zoneAtPixel,
  type PlayerState,
  type PublishedTrack,
  type RealtimeTicketClaims,
  type ServerEvent,
} from "@virtual-office/shared";

import type { Env } from "./env";

interface ConnectionAttachment extends PlayerState {
  connectionId: string;
  joinedAt: number;
  lastMoveAt: number;
}

interface MediaSessionRecord {
  userId: string;
  sessionId: string;
  createdAt: number;
}

interface StoredTrack extends PublishedTrack {
  storageVersion: 1;
}

const OFFICE_PATH = /^\/office\/([0-9a-f-]{36})\/connect$/u;
const MEDIA_PATH = /^\/office\/([0-9a-f-]{36})\/media\/(.+)$/u;
const SESSION_PREFIX = "media-session:";
const TRACK_PREFIX = "published-track:";
const MID_PREFIX = "published-mid:";
const BOUNDS_MARGIN = TILE_SIZE / 2;
const SPEED_TOLERANCE_PX = 16;

function sessionKey(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`;
}

function trackKey(sessionId: string, trackName: string): string {
  return `${TRACK_PREFIX}${sessionId}:${trackName}`;
}

function midKey(sessionId: string, mid: string): string {
  return `${MID_PREFIX}${sessionId}:${mid}`;
}

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
    const mediaMatch = MEDIA_PATH.exec(url.pathname);
    if (mediaMatch)
      return this.handleMedia(request, mediaMatch[1]!, mediaMatch[2]!);

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
      publishedTracks: await this.listPublishedTracks(),
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
    await this.cleanupUserMedia(attachment.userId);
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
    await this.cleanupUserMedia(attachment.userId);
  }

  private async handleMedia(
    request: Request,
    officeId: string,
    action: string,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST.");
    }
    if (!this.env.TICKET_SIGNING_SECRET) {
      return errorResponse(
        503,
        "TICKETS_NOT_CONFIGURED",
        "The ticket signing secret is not configured.",
      );
    }

    const token =
      request.headers.get("Authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
    let claims: RealtimeTicketClaims;
    try {
      claims = await verifyRealtimeTicket(
        token,
        this.env.TICKET_SIGNING_SECRET,
      );
    } catch {
      return errorResponse(401, "TICKET_INVALID", "Invalid media ticket.");
    }
    if (claims.officeId !== officeId) {
      return errorResponse(
        403,
        "TICKET_OFFICE_MISMATCH",
        "The ticket does not belong to this office.",
      );
    }

    let body: unknown = null;
    if (action !== "session") {
      try {
        body = (await request.json()) as unknown;
      } catch {
        return errorResponse(400, "INVALID_JSON", "Expected a JSON body.");
      }
    }

    try {
      switch (action) {
        case "session":
          return await this.createMediaSession(claims.userId);
        case "tracks/publish":
          return await this.publishTracks(claims.userId, body);
        case "tracks/subscribe":
          return await this.subscribeTracks(claims.userId, body);
        case "renegotiate":
          return await this.renegotiate(claims.userId, body);
        case "tracks/close":
          return await this.closeTracks(claims.userId, body);
        default:
          return errorResponse(404, "NOT_FOUND", "Unknown media action.");
      }
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The media request is not valid.",
      );
    }
  }

  private async createMediaSession(userId: string): Promise<Response> {
    const result = await this.callRealtime("/sessions/new", "POST");
    if (!result.response.ok) return result.response;
    const parsed = RealtimeResponseSchema.safeParse(result.json);
    const sessionId = parsed.success ? parsed.data.sessionId : undefined;
    if (!sessionId) {
      return errorResponse(
        502,
        "REALTIME_BAD_RESPONSE",
        "Realtime omitted sessionId.",
      );
    }
    const record: MediaSessionRecord = {
      userId,
      sessionId,
      createdAt: Date.now(),
    };
    await this.ctx.storage.put(sessionKey(sessionId), record);
    return result.response;
  }

  private async publishTracks(
    userId: string,
    body: unknown,
  ): Promise<Response> {
    const input = PublishTracksRequestSchema.parse(body);
    if (!(await this.ownsSession(userId, input.sessionId))) {
      return errorResponse(
        403,
        "SESSION_NOT_OWNED",
        "The media session is not yours.",
      );
    }
    const { sessionId, ...apiBody } = input;
    const result = await this.callRealtime(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      "POST",
      apiBody,
    );
    if (!result.response.ok) return result.response;
    const parsed = RealtimeResponseSchema.safeParse(result.json);
    if (!parsed.success || parsed.data.errorCode) return result.response;

    for (const requested of input.tracks) {
      const returned = parsed.data.tracks?.find(
        (track) => track.trackName === requested.trackName,
      );
      const stored: StoredTrack = {
        storageVersion: 1,
        ownerUserId: userId,
        sessionId,
        trackName: requested.trackName,
        mid: returned?.mid ?? requested.mid,
        kind: requested.kind,
      };
      await this.ctx.storage.put({
        [trackKey(sessionId, requested.trackName)]: stored,
        [midKey(sessionId, stored.mid)]: stored,
      });
      this.broadcast({
        type: "media.track.available",
        track: {
          ownerUserId: stored.ownerUserId,
          sessionId: stored.sessionId,
          trackName: stored.trackName,
          mid: stored.mid,
          kind: stored.kind,
        },
      });
    }
    return result.response;
  }

  private async subscribeTracks(
    userId: string,
    body: unknown,
  ): Promise<Response> {
    const input = SubscribeTracksRequestSchema.parse(body);
    if (!(await this.ownsSession(userId, input.sessionId))) {
      return errorResponse(
        403,
        "SESSION_NOT_OWNED",
        "The media session is not yours.",
      );
    }
    for (const track of input.tracks) {
      const stored = await this.ctx.storage.get<StoredTrack>(
        trackKey(track.sessionId, track.trackName),
      );
      if (!stored) {
        return errorResponse(
          403,
          "TRACK_NOT_AUTHORIZED",
          "The requested track is not registered in this office.",
        );
      }
      if (stored.ownerUserId === userId) {
        return errorResponse(
          403,
          "TRACK_NOT_AUTHORIZED",
          "A publisher cannot subscribe to its own track.",
        );
      }
    }

    const { sessionId, ...apiBody } = input;
    return (
      await this.callRealtime(
        `/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
        "POST",
        apiBody,
      )
    ).response;
  }

  private async renegotiate(userId: string, body: unknown): Promise<Response> {
    const input = RenegotiateRequestSchema.parse(body);
    if (!(await this.ownsSession(userId, input.sessionId))) {
      return errorResponse(
        403,
        "SESSION_NOT_OWNED",
        "The media session is not yours.",
      );
    }
    const { sessionId, ...apiBody } = input;
    return (
      await this.callRealtime(
        `/sessions/${encodeURIComponent(sessionId)}/renegotiate`,
        "PUT",
        apiBody,
      )
    ).response;
  }

  private async closeTracks(userId: string, body: unknown): Promise<Response> {
    const input = CloseTracksRequestSchema.parse(body);
    if (!(await this.ownsSession(userId, input.sessionId))) {
      return errorResponse(
        403,
        "SESSION_NOT_OWNED",
        "The media session is not yours.",
      );
    }

    const owned: StoredTrack[] = [];
    for (const track of input.tracks) {
      const stored = await this.ctx.storage.get<StoredTrack>(
        midKey(input.sessionId, track.mid),
      );
      if (stored && stored.ownerUserId !== userId) {
        return errorResponse(
          403,
          "TRACK_NOT_OWNED",
          "That track belongs to someone else.",
        );
      }
      if (stored) owned.push(stored);
    }

    const { sessionId, ...apiBody } = input;
    const result = await this.callRealtime(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      "PUT",
      apiBody,
    );
    if (!result.response.ok) return result.response;
    const parsed = RealtimeResponseSchema.safeParse(result.json);
    if (!parsed.success || parsed.data.errorCode) return result.response;

    for (const stored of owned) await this.deleteTrack(stored);
    return result.response;
  }

  private async ownsSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const record = await this.ctx.storage.get<MediaSessionRecord>(
      sessionKey(sessionId),
    );
    return record?.userId === userId;
  }

  private async listPublishedTracks(): Promise<PublishedTrack[]> {
    const stored = await this.ctx.storage.list<StoredTrack>({
      prefix: TRACK_PREFIX,
    });
    return [...stored.values()].map((track) => ({
      ownerUserId: track.ownerUserId,
      sessionId: track.sessionId,
      trackName: track.trackName,
      mid: track.mid,
      kind: track.kind,
    }));
  }

  private async deleteTrack(stored: StoredTrack): Promise<void> {
    await this.ctx.storage.delete([
      trackKey(stored.sessionId, stored.trackName),
      midKey(stored.sessionId, stored.mid),
    ]);
    this.broadcast({
      type: "media.track.revoked",
      ownerUserId: stored.ownerUserId,
      sessionId: stored.sessionId,
      trackName: stored.trackName,
    });
  }

  private async cleanupUserMedia(userId: string): Promise<void> {
    const sessions = await this.ctx.storage.list<MediaSessionRecord>({
      prefix: SESSION_PREFIX,
    });
    const tracks = await this.ctx.storage.list<StoredTrack>({
      prefix: TRACK_PREFIX,
    });
    for (const track of [...tracks.values()].filter(
      (candidate) => candidate.ownerUserId === userId,
    )) {
      try {
        await this.callRealtime(
          `/sessions/${encodeURIComponent(track.sessionId)}/tracks/close`,
          "PUT",
          { tracks: [{ mid: track.mid }], force: true },
        );
      } catch {
        // Realtime garbage collects inactive tracks; the registry must be cleaned regardless.
      }
      await this.deleteTrack(track);
    }

    const ownedSessionKeys = [...sessions.entries()]
      .filter(([, record]) => record.userId === userId)
      .map(([key]) => key);
    if (ownedSessionKeys.length > 0) {
      await this.ctx.storage.delete(ownedSessionKeys);
    }
  }

  private async callRealtime(
    path: string,
    method: "POST" | "PUT",
    body?: unknown,
  ): Promise<{ response: Response; json: unknown }> {
    const appId = this.env.CLOUDFLARE_REALTIME_APP_ID;
    const appSecret = this.env.CLOUDFLARE_REALTIME_APP_SECRET;
    if (!appId || !appSecret) {
      return {
        response: errorResponse(
          503,
          "REALTIME_NOT_CONFIGURED",
          "Cloudflare Realtime credentials are not configured on the Worker.",
        ),
        json: null,
      };
    }

    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${appSecret}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const text = await upstream.text();
    let json: unknown = null;
    try {
      json = text.length === 0 ? null : (JSON.parse(text) as unknown);
    } catch {
      json = null;
    }
    return {
      response: new Response(text, {
        status: upstream.status,
        headers: {
          "Content-Type":
            upstream.headers.get("Content-Type") ?? "application/json",
          "Cache-Control": "no-store",
        },
      }),
      json,
    };
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
