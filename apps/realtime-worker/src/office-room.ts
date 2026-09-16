import { DurableObject } from "cloudflare:workers";

import {
  authorizeDeskActivation,
  authorizeSpatialMovement,
  authorizeStoredTrackPull,
  canActivateManualSpeaker,
  canModerateManualSpeaker,
  ClientEventSchema,
  CloseTracksRequestSchema,
  effectiveBroadcastSpeakerIds,
  MAX_SPEED_PX_PER_S,
  OFFICE_MAP,
  presenceFromAttachment,
  PublishTracksRequestSchema,
  RealtimeResponseSchema,
  shouldReceiveChatFanOut,
  reconcileZoneBroadcastSpeakers,
  RenegotiateRequestSchema,
  spawnPointsForAccess,
  SubscribeTracksRequestSchema,
  ticketAccessClass,
  TILE_SIZE,
  isBlockedAtPixel,
  mapPixelSize,
  parseAvatarAppearance,
  spawnPixel,
  verifyRealtimeTicket,
  zoneAtPixel,
  type PlayerState,
  type PublishedTrack,
  type RealtimeTicketClaims,
  type ServerEvent,
  type SpatialAccessClass,
  type SpatialChatChannelKind,
} from "@virtual-office/shared";

import type { Env } from "./env";

interface ConnectionAttachment extends PlayerState {
  connectionId: string;
  officeId: string;
  authorizedUntil: number;
  joinedAt: number;
  lastMoveAt: number;
  lastChatAt?: number;
  accessClass: SpatialAccessClass;
  zoneBroadcastActive: boolean;
  manualBroadcastSpeaker: boolean;
}

interface MediaSessionRecord {
  userId: string;
  connectionId: string;
  sessionId: string;
  createdAt: number;
}

interface StoredTrack extends PublishedTrack {
  storageVersion: 1;
}

interface StoredSubscription {
  subscriberUserId: string;
  publisherUserId: string;
  sessionId: string;
  mid: string;
  publisherSessionId: string;
  trackName: string;
}

const OFFICE_PATH = /^\/office\/([0-9a-f-]{36})\/connect$/u;
const MEDIA_PATH = /^\/office\/([0-9a-f-]{36})\/media\/(.+)$/u;
const INTERNAL_CHAT_PATH =
  /^\/office\/([0-9a-f-]{36})\/internal\/chat-fanout$/u;
const SESSION_PREFIX = "media-session:";
const TRACK_PREFIX = "published-track:";
const MID_PREFIX = "published-mid:";
const SUBSCRIPTION_PREFIX = "media-subscription:";
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

function isActiveConnection(
  webSocket: WebSocket,
  attachment: ConnectionAttachment,
): boolean {
  return (
    webSocket.readyState === WebSocket.OPEN &&
    attachment.authorizedUntil > Date.now()
  );
}

function playerOf(
  attachment: ConnectionAttachment,
  includeAppearance = false,
): PlayerState {
  const presence = presenceFromAttachment(
    {
      userId: attachment.userId,
      accessClass: attachment.accessClass,
      zoneId: attachment.zoneId,
      zoneBroadcastActive: attachment.zoneBroadcastActive,
      manualBroadcastSpeaker: attachment.manualBroadcastSpeaker,
    },
    OFFICE_MAP,
  );
  return {
    userId: attachment.userId,
    displayName: attachment.displayName,
    x: attachment.x,
    y: attachment.y,
    direction: attachment.direction,
    moving: attachment.moving,
    zoneId: attachment.zoneId,
    ...(attachment.currentDeskId
      ? { currentDeskId: attachment.currentDeskId }
      : {}),
    inBroadcastZone: presence.inBroadcastZone,
    broadcastCapacityBlocked: presence.broadcastCapacityBlocked,
    broadcastSpeakerSource: presence.broadcastSpeakerSource,
    lastSeq: attachment.lastSeq,
    ...(includeAppearance && attachment.appearance
      ? { appearance: attachment.appearance }
      : {}),
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
  private subscriptions = new Map<string, StoredSubscription>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Hibernation/deploys must not restore an unlimited authorization lease.
    ctx.blockConcurrencyWhile(async () => {
      this.subscriptions = await ctx.storage.list<StoredSubscription>({
        prefix: SUBSCRIPTION_PREFIX,
      });
      await this.scheduleSecurityAlarm();
    });
  }

  async alarm(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(socket);
      if (attachment && !isActiveConnection(socket, attachment)) {
        await this.expireConnection(socket, attachment);
      }
    }
    await this.reconcileSubscriptions();
    await this.scheduleSecurityAlarm();
  }

  private async scheduleSecurityAlarm(retry = false): Promise<void> {
    const deadlines = this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map((socket) => attachmentOf(socket)?.authorizedUntil ?? Date.now());
    if (retry) deadlines.push(Date.now() + 1_000);
    if (!deadlines.length) return;
    const next = Math.max(Date.now() + 1, Math.min(...deadlines));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next < current)
      await this.ctx.storage.setAlarm(next);
  }

  private async expireConnection(
    socket: WebSocket,
    attachment: ConnectionAttachment,
  ): Promise<void> {
    socket.serializeAttachment({ ...attachment, authorizedUntil: 0 });
    socket.close(
      4003,
      "Spatial authorization expired; reconnect with a fresh ticket",
    );
    if (
      !this.hasAnotherConnection(attachment.userId, attachment.connectionId)
    ) {
      this.broadcast({ type: "player.left", userId: attachment.userId });
      await this.cleanupUserMedia(attachment.userId);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internalMatch = INTERNAL_CHAT_PATH.exec(url.pathname);
    if (internalMatch) {
      if (request.method !== "POST") {
        return errorResponse(405, "METHOD_NOT_ALLOWED", "Use POST.");
      }
      return this.handleInternalChatFanout(request);
    }

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

    const accessClass = ticketAccessClass(claims);
    const spawnPoints = spawnPointsForAccess(OFFICE_MAP, accessClass);
    const spawnIndex = distinctUsers.size % spawnPoints.length;
    const spawn = spawnPixel(spawnPoints[spawnIndex]!);
    const now = Date.now();
    const priorPosition =
      prior &&
      authorizeSpatialMovement({
        accessClass,
        destinationX: prior.x,
        destinationY: prior.y,
        map: OFFICE_MAP,
      }).allowed
        ? prior
        : null;
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      officeId: claims.officeId,
      authorizedUntil: claims.expiresAt,
      userId: claims.userId,
      displayName: claims.displayName,
      x: priorPosition?.x ?? spawn.x,
      y: priorPosition?.y ?? spawn.y,
      direction: priorPosition?.direction ?? "down",
      moving: false,
      zoneId: zoneAtPixel(
        OFFICE_MAP,
        priorPosition?.x ?? spawn.x,
        priorPosition?.y ?? spawn.y,
      ),
      lastSeq: priorPosition?.lastSeq ?? 0,
      joinedAt: priorPosition?.joinedAt ?? now,
      lastMoveAt: now,
      accessClass,
      currentDeskId: null,
      zoneBroadcastActive: false,
      manualBroadcastSpeaker: false,
      ...(priorPosition?.appearance
        ? { appearance: priorPosition.appearance }
        : {}),
    };

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    await this.scheduleSecurityAlarm();
    this.reconcileBroadcastStates();
    for (const duplicate of duplicates) {
      duplicate.webSocket.close(4001, "Replaced by a newer connection");
    }
    if (duplicates.length > 0) {
      await this.cleanupUserMedia(claims.userId);
    }

    const players = this.connectedPlayers(claims.userId);
    players.push(playerOf(attachment, true));
    safeSend(server, {
      type: "office.snapshot",
      selfUserId: claims.userId,
      players,
      publishedTracks: await this.listPublishedTracks(),
      serverTime: now,
    });
    this.broadcast(
      { type: "player.joined", player: playerOf(attachment, true) },
      attachment.connectionId,
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    webSocket: WebSocket,
    message: ArrayBuffer | string,
  ): Promise<void> {
    if (typeof message !== "string" || message.length > 4_096) {
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
    if (!isActiveConnection(webSocket, attachment)) {
      await this.expireConnection(webSocket, attachment);
      return;
    }
    if (data.type === "session.refresh") {
      try {
        const claims = await verifyRealtimeTicket(
          data.ticket,
          this.env.TICKET_SIGNING_SECRET ?? "",
        );
        if (
          claims.userId !== attachment.userId ||
          claims.officeId !== attachment.officeId ||
          ticketAccessClass(claims) !== attachment.accessClass
        ) {
          await this.expireConnection(webSocket, attachment);
          return;
        }
        // Recheck after the signature verification yields, including replacement tabs.
        const current = attachmentOf(webSocket);
        if (!current || !isActiveConnection(webSocket, current)) return;
        webSocket.serializeAttachment({
          ...current,
          authorizedUntil: Math.max(current.authorizedUntil, claims.expiresAt),
        });
        await this.scheduleSecurityAlarm();
      } catch {
        await this.expireConnection(webSocket, attachment);
      }
      return;
    }
    if (data.type === "ping") {
      safeSend(webSocket, {
        type: "pong",
        clientTime: data.clientTime,
        serverTime: now,
      });
      return;
    }

    if (data.type === "desk.use") {
      this.handleDeskUse(webSocket, attachment, data.deskId, now);
      await this.reconcileSubscriptions(attachment.userId);
      return;
    }

    if (data.type === "broadcast.setSpeaker") {
      this.handleBroadcastSetSpeaker(
        webSocket,
        attachment,
        data.targetUserId,
        now,
      );
      await this.reconcileSubscriptions();
      return;
    }

    if (data.type === "broadcast.removeSpeaker") {
      this.handleBroadcastRemoveSpeaker(
        webSocket,
        attachment,
        data.targetUserId,
        now,
      );
      await this.reconcileSubscriptions();
      return;
    }

    if (data.type === "player.avatar.set") {
      const appearance = parseAvatarAppearance(data.appearance);
      if (!appearance) {
        safeSend(webSocket, {
          type: "error",
          code: "INVALID_AVATAR",
          message: "Avatar appearance is not in the trusted catalog.",
        });
        return;
      }
      const updated: ConnectionAttachment = { ...attachment, appearance };
      webSocket.serializeAttachment(updated);
      this.broadcast({
        type: "player.avatar.updated",
        userId: attachment.userId,
        appearance,
        serverTime: now,
      });
      return;
    }

    if (data.seq <= attachment.lastSeq) return;

    const correct = (
      reason: "speed" | "collision" | "bounds" | "zone_access",
    ) => {
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

    const movement = authorizeSpatialMovement({
      accessClass: attachment.accessClass,
      destinationX: x,
      destinationY: y,
      map: OFFICE_MAP,
    });
    if (!movement.allowed) {
      correct("zone_access");
      return;
    }

    const updated: ConnectionAttachment = {
      ...attachment,
      x,
      y,
      direction: data.direction,
      moving: data.moving,
      zoneId: zoneAtPixel(OFFICE_MAP, x, y),
      currentDeskId: null,
      lastSeq: data.seq,
      lastMoveAt: now,
    };
    webSocket.serializeAttachment(updated);
    this.reconcileBroadcastStates();
    this.broadcast({
      type: "player.updated",
      player: playerOf(updated),
      serverTime: now,
    });
    await this.reconcileSubscriptions(attachment.userId);
  }

  async webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const attachment = attachmentOf(webSocket);
    webSocket.close(code, reason);
    if (!attachment) return;
    if (code === 4003 && attachment.authorizedUntil === 0) return;
    const replacedByNewerTab = code === 4001;
    if (
      replacedByNewerTab ||
      this.hasAnotherConnection(attachment.userId, attachment.connectionId)
    ) {
      return;
    }
    this.broadcast({ type: "player.left", userId: attachment.userId });
    this.reconcileBroadcastStates();
    await this.cleanupUserMedia(attachment.userId);
  }

  async webSocketError(webSocket: WebSocket): Promise<void> {
    const attachment = attachmentOf(webSocket);
    if (
      !attachment ||
      attachment.authorizedUntil === 0 ||
      this.hasAnotherConnection(attachment.userId, attachment.connectionId)
    ) {
      return;
    }
    this.broadcast({ type: "player.left", userId: attachment.userId });
    this.reconcileBroadcastStates();
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
        case "tracks/announce":
          return await this.announceTracks(claims.userId, body);
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
    const connection = this.attachmentForUser(userId);
    if (!connection) {
      return errorResponse(
        403,
        "PRESENCE_REQUIRED",
        "An active spatial connection is required.",
      );
    }
    const result = await this.callRealtime("/sessions/new", "POST");
    if (!result.response.ok) return result.response;
    const parsed = RealtimeResponseSchema.safeParse(result.json);
    const sessionId =
      parsed.success && !parsed.data.errorCode
        ? parsed.data.sessionId
        : undefined;
    if (!sessionId) {
      return errorResponse(
        502,
        "REALTIME_BAD_RESPONSE",
        "Realtime omitted sessionId.",
      );
    }
    if (
      this.attachmentForUser(userId)?.connectionId !== connection.connectionId
    ) {
      return errorResponse(
        403,
        "PRESENCE_REQUIRED",
        "Spatial connection changed during media setup.",
      );
    }
    const record: MediaSessionRecord = {
      userId,
      connectionId: connection.connectionId,
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
    await this.revokePublisherTracksOutsideSession(userId, input.sessionId);
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
      if (!returned || returned.errorCode || !returned.mid) continue;
      if (!(await this.ownsSession(userId, sessionId))) {
        await this.callRealtime(
          `/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
          "PUT",
          {
            tracks: [{ mid: returned.mid }],
            force: true,
          },
        );
        continue;
      }
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
      // Do not broadcast yet. Remotes that subscribe before the publisher
      // applies the SFU SDP get empty mids and one-way audio. The client
      // calls tracks/announce after send ICE is connected.
    }
    return result.response;
  }

  private broadcastStoredTrack(stored: StoredTrack | PublishedTrack): void {
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

  private async announceTracks(
    userId: string,
    body: unknown,
  ): Promise<Response> {
    const sessionId =
      body && typeof body === "object" && "sessionId" in body
        ? String((body as { sessionId?: unknown }).sessionId ?? "")
        : "";
    if (!sessionId) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The media request is not valid.",
      );
    }
    if (!(await this.ownsSession(userId, sessionId))) {
      return errorResponse(
        403,
        "SESSION_NOT_OWNED",
        "The media session is not yours.",
      );
    }
    let announced = 0;
    for (const track of await this.listPublishedTracks()) {
      if (track.ownerUserId !== userId || track.sessionId !== sessionId) {
        continue;
      }
      this.broadcastStoredTrack(track);
      announced += 1;
    }
    return Response.json({ ok: true, announced });
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
      const pull = this.authorizeTrackPull(userId, stored);
      if (!pull.ok) {
        return errorResponse(
          403,
          "TRACK_NOT_AUTHORIZED",
          `Track knowledge is not enough (${pull.reason}).`,
        );
      }
    }

    const { sessionId, ...apiBody } = input;
    const result = await this.callRealtime(
      `/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      "POST",
      apiBody,
    );
    if (result.response.status === 410) {
      await this.ctx.storage.delete(sessionKey(sessionId));
    }
    const parsed = RealtimeResponseSchema.safeParse(result.json);
    if (result.response.ok && parsed.success && !parsed.data.errorCode) {
      for (const requested of input.tracks) {
        const returned = parsed.data.tracks?.find(
          (track) =>
            track.trackName === requested.trackName &&
            track.sessionId === requested.sessionId,
        );
        if (!returned?.mid || returned.errorCode) continue;
        const stored = await this.ctx.storage.get<StoredTrack>(
          trackKey(requested.sessionId, requested.trackName),
        );
        const subscription: StoredSubscription = {
          subscriberUserId: userId,
          publisherUserId: stored?.ownerUserId ?? "",
          sessionId,
          mid: returned.mid,
          publisherSessionId: requested.sessionId,
          trackName: requested.trackName,
        };
        const key = `${SUBSCRIPTION_PREFIX}${sessionId}:${returned.mid}`;
        this.subscriptions.set(key, subscription);
        await this.ctx.storage.put(key, subscription);
      }
      // Position, lease or socket ownership can change while awaiting the SFU.
      await this.reconcileSubscriptions(userId);
    }
    return result.response;
  }

  private authorizeTrackPull(userId: string, stored: StoredTrack) {
    const subscriber = this.attachmentForUser(userId);
    const publisher = this.attachmentForUser(stored.ownerUserId);
    return authorizeStoredTrackPull({
      subscriberUserId: userId,
      ownerUserId: stored.ownerUserId,
      subscriber,
      publisher,
      ...(subscriber && publisher
        ? {
            subscriberAccessClass: subscriber.accessClass,
            publisherAccessClass: publisher.accessClass,
          }
        : {}),
      map: OFFICE_MAP,
      trackKind: stored.kind,
      broadcastSpeakerUserIds: this.activeBroadcastSpeakerIds(),
    });
  }

  private async reconcileSubscriptions(affectedUserId?: string): Promise<void> {
    for (const [key, subscription] of [...this.subscriptions]) {
      if (
        affectedUserId &&
        subscription.subscriberUserId !== affectedUserId &&
        subscription.publisherUserId !== affectedUserId
      )
        continue;
      const track = await this.ctx.storage.get<StoredTrack>(
        trackKey(subscription.publisherSessionId, subscription.trackName),
      );
      if (
        track &&
        this.authorizeTrackPull(subscription.subscriberUserId, track).ok &&
        (await this.ownsSession(
          subscription.subscriberUserId,
          subscription.sessionId,
        ))
      )
        continue;
      try {
        const result = await this.callRealtime(
          `/sessions/${encodeURIComponent(subscription.sessionId)}/tracks/close`,
          "PUT",
          { tracks: [{ mid: subscription.mid }], force: true },
        );
        const parsed = RealtimeResponseSchema.safeParse(result.json);
        if (
          result.response.status === 410 ||
          (result.response.ok &&
            parsed.success &&
            !parsed.data.errorCode &&
            !parsed.data.tracks?.some((item) => item.errorCode))
        ) {
          if (this.subscriptions.get(key) === subscription) {
            this.subscriptions.delete(key);
            await this.ctx.storage.delete(key);
          }
          continue;
        }
      } catch {
        // Keep the durable record until the SFU confirms revocation.
      }
      await this.scheduleSecurityAlarm(true);
    }
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

    const confirmedMids = new Set(
      input.tracks
        .filter((track) => {
          if (!parsed.data.tracks) return true;
          const closed = parsed.data.tracks.find(
            (item) => item.mid === track.mid,
          );
          return closed && !closed.errorCode;
        })
        .map((track) => track.mid),
    );
    for (const stored of owned) {
      if (confirmedMids.has(stored.mid)) await this.deleteTrack(stored);
    }
    for (const track of input.tracks.filter((item) =>
      confirmedMids.has(item.mid),
    )) {
      const key = `${SUBSCRIPTION_PREFIX}${input.sessionId}:${track.mid}`;
      this.subscriptions.delete(key);
      await this.ctx.storage.delete(key);
    }
    return result.response;
  }

  private attachmentForUser(userId: string): ConnectionAttachment | null {
    let latest: ConnectionAttachment | null = null;
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (
        attachment?.userId !== userId ||
        !isActiveConnection(webSocket, attachment)
      )
        continue;
      if (!latest || attachment.joinedAt >= latest.joinedAt) {
        latest = attachment;
      }
    }
    return latest;
  }

  private playerForUser(userId: string): {
    x: number;
    y: number;
    zoneId: string | null;
  } | null {
    const latest = this.attachmentForUser(userId);
    if (!latest) return null;
    return { x: latest.x, y: latest.y, zoneId: latest.zoneId };
  }

  private async ownsSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const record = await this.ctx.storage.get<MediaSessionRecord>(
      sessionKey(sessionId),
    );
    const connection = this.attachmentForUser(userId);
    return Boolean(
      connection &&
      record?.userId === userId &&
      record.connectionId === connection.connectionId,
    );
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
    await this.reconcileSubscriptions(stored.ownerUserId);
  }

  private async revokePublisherTracksOutsideSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const tracks = await this.ctx.storage.list<StoredTrack>({
      prefix: TRACK_PREFIX,
    });
    for (const track of [...tracks.values()].filter(
      (candidate) =>
        candidate.ownerUserId === userId && candidate.sessionId !== sessionId,
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
    await this.reconcileSubscriptions(userId);
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
        signal: AbortSignal.timeout(8_000),
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

  private deskOccupantSnapshots(): Array<{
    userId: string;
    currentDeskId: string | null;
  }> {
    const latest = new Map<string, ConnectionAttachment>();
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (!attachment || !isActiveConnection(webSocket, attachment)) continue;
      const current = latest.get(attachment.userId);
      if (!current || attachment.joinedAt >= current.joinedAt) {
        latest.set(attachment.userId, attachment);
      }
    }
    return [...latest.values()].map((attachment) => ({
      userId: attachment.userId,
      currentDeskId: attachment.currentDeskId ?? null,
    }));
  }

  private handleDeskUse(
    webSocket: WebSocket,
    attachment: ConnectionAttachment,
    deskId: string,
    now: number,
  ): void {
    const decision = authorizeDeskActivation({
      deskId,
      userId: attachment.userId,
      x: attachment.x,
      y: attachment.y,
      accessClass: attachment.accessClass,
      map: OFFICE_MAP,
      occupants: this.deskOccupantSnapshots(),
      currentDeskId: attachment.currentDeskId ?? null,
    });

    if (!decision.allowed) {
      safeSend(webSocket, {
        type: "error",
        code: `DESK_${decision.reason.toUpperCase()}`,
        message: "Workstation activation was rejected.",
      });
      return;
    }

    const snap = decision.snapPosition!;
    const updated: ConnectionAttachment = {
      ...attachment,
      x: snap.x,
      y: snap.y,
      moving: false,
      direction: decision.desk?.orientation ?? attachment.direction,
      zoneId: zoneAtPixel(OFFICE_MAP, snap.x, snap.y),
      currentDeskId: deskId,
      lastMoveAt: now,
    };
    webSocket.serializeAttachment(updated);
    this.reconcileBroadcastStates();
    this.broadcast({
      type: "player.updated",
      player: playerOf(updated),
      serverTime: now,
    });
  }

  private handleInternalChatFanout(request: Request): Promise<Response> {
    return (async () => {
      let parsed: unknown;
      try {
        parsed = await request.json();
      } catch {
        return errorResponse(400, "INVALID_JSON", "Expected JSON body.");
      }
      if (!parsed || typeof parsed !== "object") {
        return errorResponse(400, "INVALID_EVENT", "Invalid fan-out payload.");
      }
      const event = parsed as {
        type?: string;
        messageId?: string;
        channelId?: string;
        channelKind?: SpatialChatChannelKind;
        authorUserId?: string;
        displayName?: string;
        body?: string;
        createdAt?: string;
        memberUserIds?: string[];
      };
      if (
        event.type !== "chat.message.created" ||
        !event.messageId ||
        !event.channelId ||
        !event.channelKind ||
        !event.authorUserId ||
        !event.displayName ||
        !event.body ||
        !event.createdAt
      ) {
        return errorResponse(400, "INVALID_EVENT", "Invalid chat fan-out.");
      }

      const payload: ServerEvent = {
        type: "chat.message.created",
        messageId: event.messageId,
        channelId: event.channelId,
        channelKind: event.channelKind,
        authorUserId: event.authorUserId,
        displayName: event.displayName,
        body: event.body,
        createdAt: event.createdAt,
        ...(event.memberUserIds ? { memberUserIds: event.memberUserIds } : {}),
      };

      for (const webSocket of this.ctx.getWebSockets()) {
        const attachment = attachmentOf(webSocket);
        if (!attachment || !isActiveConnection(webSocket, attachment)) continue;
        if (
          !shouldReceiveChatFanOut({
            accessClass: attachment.accessClass,
            userId: attachment.userId,
            channelKind: event.channelKind,
            ...(event.memberUserIds
              ? { memberUserIds: event.memberUserIds }
              : {}),
          })
        ) {
          continue;
        }
        safeSend(webSocket, payload);
      }

      return Response.json({ ok: true });
    })();
  }

  private broadcastAttachmentStates() {
    return [...this.latestAttachmentsMap().values()].map(({ attachment }) => ({
      userId: attachment.userId,
      accessClass: attachment.accessClass,
      zoneId: attachment.zoneId,
      zoneBroadcastActive: attachment.zoneBroadcastActive,
      manualBroadcastSpeaker: attachment.manualBroadcastSpeaker,
    }));
  }

  private activeBroadcastSpeakerIds(): Set<string> {
    return effectiveBroadcastSpeakerIds(this.broadcastAttachmentStates());
  }

  private latestAttachmentsMap(): Map<
    string,
    { webSocket: WebSocket; attachment: ConnectionAttachment }
  > {
    const latest = new Map<
      string,
      { webSocket: WebSocket; attachment: ConnectionAttachment }
    >();
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (!attachment || !isActiveConnection(webSocket, attachment)) continue;
      const current = latest.get(attachment.userId);
      if (!current || attachment.joinedAt >= current.attachment.joinedAt) {
        latest.set(attachment.userId, { webSocket, attachment });
      }
    }
    return latest;
  }

  private reconcileBroadcastStates(): void {
    const entries = [...this.latestAttachmentsMap().entries()];
    const states = reconcileZoneBroadcastSpeakers(
      entries.map(([, { attachment }]) => ({
        userId: attachment.userId,
        accessClass: attachment.accessClass,
        zoneId: attachment.zoneId,
        zoneBroadcastActive: attachment.zoneBroadcastActive,
        manualBroadcastSpeaker: attachment.manualBroadcastSpeaker,
      })),
      OFFICE_MAP,
    );
    const now = Date.now();
    for (const [userId, { webSocket, attachment }] of entries) {
      const zoneState = states.get(userId);
      const nextZoneActive = zoneState?.active ?? false;
      if (attachment.zoneBroadcastActive === nextZoneActive) continue;
      const updated: ConnectionAttachment = {
        ...attachment,
        zoneBroadcastActive: nextZoneActive,
      };
      webSocket.serializeAttachment(updated);
      this.broadcast({
        type: "player.updated",
        player: playerOf(updated),
        serverTime: now,
      });
    }
  }

  private updateUserAttachment(
    userId: string,
    updater: (current: ConnectionAttachment) => ConnectionAttachment,
  ): ConnectionAttachment | null {
    let updated: ConnectionAttachment | null = null;
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (
        attachment?.userId !== userId ||
        !isActiveConnection(webSocket, attachment)
      )
        continue;
      updated = updater(attachment);
      webSocket.serializeAttachment(updated);
    }
    return updated;
  }

  private handleBroadcastSetSpeaker(
    webSocket: WebSocket,
    attachment: ConnectionAttachment,
    targetUserId: string,
    now: number,
  ): void {
    if (!canModerateManualSpeaker(attachment.accessClass)) {
      safeSend(webSocket, {
        type: "error",
        code: "BROADCAST_NOT_AUTHORIZED",
        message: "Manual speaker moderation is not allowed.",
      });
      return;
    }

    const decision = canActivateManualSpeaker({
      attachments: this.broadcastAttachmentStates(),
      map: OFFICE_MAP,
      targetUserId,
    });
    if (!decision.allowed) {
      safeSend(webSocket, {
        type: "error",
        code: `BROADCAST_${decision.reason}`,
        message: "Manual speaker activation was rejected.",
      });
      return;
    }

    const updated = this.updateUserAttachment(targetUserId, (current) => ({
      ...current,
      manualBroadcastSpeaker: true,
    }));
    if (!updated) {
      safeSend(webSocket, {
        type: "error",
        code: "BROADCAST_TARGET_NOT_FOUND",
        message: "The target participant is not connected.",
      });
      return;
    }

    this.broadcast({
      type: "player.updated",
      player: playerOf(updated),
      serverTime: now,
    });
  }

  private handleBroadcastRemoveSpeaker(
    webSocket: WebSocket,
    attachment: ConnectionAttachment,
    targetUserId: string,
    now: number,
  ): void {
    if (!canModerateManualSpeaker(attachment.accessClass)) {
      safeSend(webSocket, {
        type: "error",
        code: "BROADCAST_NOT_AUTHORIZED",
        message: "Manual speaker moderation is not allowed.",
      });
      return;
    }

    const updated = this.updateUserAttachment(targetUserId, (current) => ({
      ...current,
      manualBroadcastSpeaker: false,
    }));
    if (!updated) {
      safeSend(webSocket, {
        type: "error",
        code: "BROADCAST_TARGET_NOT_FOUND",
        message: "The target participant is not connected.",
      });
      return;
    }

    this.broadcast({
      type: "player.updated",
      player: playerOf(updated),
      serverTime: now,
    });
  }

  private connectedPlayers(excludeUserId?: string): PlayerState[] {
    const latest = new Map<string, ConnectionAttachment>();
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (
        !attachment ||
        !isActiveConnection(webSocket, attachment) ||
        attachment.userId === excludeUserId
      )
        continue;
      const current = latest.get(attachment.userId);
      if (!current || attachment.joinedAt >= current.joinedAt) {
        latest.set(attachment.userId, attachment);
      }
    }
    return [...latest.values()].map((attachment) => playerOf(attachment, true));
  }

  private hasAnotherConnection(userId: string, connectionId: string): boolean {
    return this.ctx.getWebSockets().some((candidate) => {
      const attachment = attachmentOf(candidate);
      return (
        attachment?.userId === userId &&
        isActiveConnection(candidate, attachment) &&
        attachment.connectionId !== connectionId
      );
    });
  }

  private broadcast(event: ServerEvent, excludeConnectionId?: string): void {
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (
        !attachment ||
        !isActiveConnection(webSocket, attachment) ||
        attachment.connectionId === excludeConnectionId
      )
        continue;
      safeSend(webSocket, event);
    }
  }
}
