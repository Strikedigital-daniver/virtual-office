import { DurableObject } from "cloudflare:workers";
import {
  ClientEventSchema,
  type PlayerState,
  type PublishedAudioRef,
  type ServerEvent,
} from "../shared/protocol";
import {
  CloseTracksRequestSchema,
  PublishTracksRequestSchema,
  RealtimeResponseSchema,
  RenegotiateRequestSchema,
  SubscribeTracksRequestSchema,
} from "../shared/realtime";
import type { Env } from "./env";
import { errorResponse, readJson } from "./http";

interface ConnectionAttachment extends PlayerState {
  connectionId: string;
  joinedAt: number;
}

interface MediaSessionRecord {
  clientId: string;
  sessionId: string;
  createdAt: number;
}

interface StoredPublishedTrack extends PublishedAudioRef {
  storageVersion: 1;
}

interface InternalIdentity {
  clientId: string;
  displayName: string;
}

const SESSION_PREFIX = "media-session:";
const TRACK_PREFIX = "published-track:";
const MID_PREFIX = "published-mid:";

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
  const value = webSocket.deserializeAttachment();
  if (!value || typeof value !== "object") return null;
  return value as ConnectionAttachment;
}

function playerFromAttachment(attachment: ConnectionAttachment): PlayerState {
  return {
    clientId: attachment.clientId,
    displayName: attachment.displayName,
    x: attachment.x,
    y: attachment.y,
    lastSeq: attachment.lastSeq,
  };
}

function safeSend(webSocket: WebSocket, event: ServerEvent): void {
  try {
    webSocket.send(JSON.stringify(event));
  } catch {
    // The close/error callback owns cleanup for sockets that disappeared mid-broadcast.
  }
}

export class OfficeRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/connect") return this.acceptBrowserConnection(request);

    const identity = this.internalIdentity(request);
    if (!identity) return errorResponse(401, "INTERNAL_IDENTITY_REQUIRED", "Missing internal identity.");

    switch (path) {
      case "/media/session":
        return this.createMediaSession(identity);
      case "/media/tracks/publish":
        return this.publishTracks(identity, request);
      case "/media/tracks/subscribe":
        return this.subscribeTracks(identity, request);
      case "/media/renegotiate":
        return this.renegotiate(identity, request);
      case "/media/tracks/close":
        return this.closeTracks(identity, request);
      default:
        return errorResponse(404, "NOT_FOUND", "Durable Object endpoint not found.");
    }
  }

  async webSocketMessage(webSocket: WebSocket, message: ArrayBuffer | string): Promise<void> {
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
        message: "The event does not match the Sprint 0 protocol.",
      });
      return;
    }

    const attachment = attachmentOf(webSocket);
    if (!attachment) {
      webSocket.close(1011, "Connection state unavailable");
      return;
    }

    if (result.data.type === "ping") {
      safeSend(webSocket, {
        type: "pong",
        clientTime: result.data.clientTime,
        serverTime: Date.now(),
      });
      return;
    }

    if (result.data.seq <= attachment.lastSeq) return;
    const updated: ConnectionAttachment = {
      ...attachment,
      x: Math.min(616, Math.max(0, result.data.x)),
      y: Math.min(336, Math.max(0, result.data.y)),
      lastSeq: result.data.seq,
    };
    webSocket.serializeAttachment(updated);
    this.broadcast({ type: "player.updated", player: playerFromAttachment(updated) });
  }

  async webSocketClose(
    webSocket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    const attachment = attachmentOf(webSocket);
    webSocket.close(code, reason);
    if (!attachment || this.hasAnotherConnection(attachment.clientId, attachment.connectionId)) return;
    this.broadcast({ type: "player.left", clientId: attachment.clientId });
    await this.cleanupClientMedia(attachment.clientId);
  }

  async webSocketError(webSocket: WebSocket): Promise<void> {
    const attachment = attachmentOf(webSocket);
    if (!attachment || this.hasAnotherConnection(attachment.clientId, attachment.connectionId)) return;
    this.broadcast({ type: "player.left", clientId: attachment.clientId });
    await this.cleanupClientMedia(attachment.clientId);
  }

  private async acceptBrowserConnection(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return errorResponse(426, "UPGRADE_REQUIRED", "Expected a WebSocket upgrade.");
    }
    const identity = this.internalIdentity(request);
    if (!identity) return errorResponse(401, "INTERNAL_IDENTITY_REQUIRED", "Missing internal identity.");

    const duplicates = this.ctx
      .getWebSockets()
      .map((webSocket) => ({ webSocket, attachment: attachmentOf(webSocket) }))
      .filter(
        (entry): entry is { webSocket: WebSocket; attachment: ConnectionAttachment } =>
          entry.attachment?.clientId === identity.clientId,
      );
    const prior = duplicates.at(-1)?.attachment;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      clientId: identity.clientId,
      displayName: identity.displayName,
      x: prior?.x ?? 60,
      y: prior?.y ?? 60,
      lastSeq: prior?.lastSeq ?? 0,
      joinedAt: prior?.joinedAt ?? Date.now(),
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    for (const duplicate of duplicates) {
      duplicate.webSocket.close(4001, "Replaced by a newer connection");
    }

    const players = this.connectedPlayers(identity.clientId);
    players.push(playerFromAttachment(attachment));
    const publishedAudio = await this.listPublishedTracks();
    safeSend(server, {
      type: "office.snapshot",
      selfClientId: identity.clientId,
      players,
      publishedAudio,
      serverTime: Date.now(),
    });
    this.broadcast(
      { type: "player.joined", player: playerFromAttachment(attachment) },
      attachment.connectionId,
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  private internalIdentity(request: Request): InternalIdentity | null {
    const clientId = request.headers.get("X-Spike-Client-Id");
    const displayName = request.headers.get("X-Spike-Display-Name");
    if (!clientId || !displayName) return null;
    return { clientId, displayName };
  }

  private connectedPlayers(excludeClientId?: string): PlayerState[] {
    const latest = new Map<string, ConnectionAttachment>();
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (!attachment || attachment.clientId === excludeClientId) continue;
      const current = latest.get(attachment.clientId);
      if (!current || attachment.joinedAt >= current.joinedAt) {
        latest.set(attachment.clientId, attachment);
      }
    }
    return [...latest.values()].map(playerFromAttachment);
  }

  private hasAnotherConnection(clientId: string, connectionId: string): boolean {
    return this.ctx.getWebSockets().some((candidate) => {
      const attachment = attachmentOf(candidate);
      return attachment?.clientId === clientId && attachment.connectionId !== connectionId;
    });
  }

  private broadcast(event: ServerEvent, excludeConnectionId?: string): void {
    for (const webSocket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(webSocket);
      if (attachment?.connectionId === excludeConnectionId) continue;
      safeSend(webSocket, event);
    }
  }

  private async createMediaSession(identity: InternalIdentity): Promise<Response> {
    const result = await this.callRealtime("/sessions/new", "POST");
    if (!result.response.ok) return result.response;
    const parsed = RealtimeResponseSchema.safeParse(result.json);
    const sessionId = parsed.success ? parsed.data.sessionId : undefined;
    if (!sessionId) return errorResponse(502, "REALTIME_BAD_RESPONSE", "Realtime omitted sessionId.");
    const record: MediaSessionRecord = { clientId: identity.clientId, sessionId, createdAt: Date.now() };
    await this.ctx.storage.put(sessionKey(sessionId), record);
    return result.response;
  }

  private async publishTracks(identity: InternalIdentity, request: Request): Promise<Response> {
    const input = PublishTracksRequestSchema.parse(await readJson(request));
    if (!(await this.ownsSession(identity.clientId, input.sessionId))) {
      return errorResponse(403, "SESSION_NOT_OWNED", "The media session does not belong to this client.");
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
      const returned = parsed.data.tracks?.find((track) => track.trackName === requested.trackName);
      const mid = returned?.mid ?? requested.mid;
      const stored: StoredPublishedTrack = {
        storageVersion: 1,
        ownerClientId: identity.clientId,
        sessionId,
        trackName: requested.trackName,
        mid,
        kind: "audio",
      };
      await this.ctx.storage.put({
        [trackKey(sessionId, requested.trackName)]: stored,
        [midKey(sessionId, mid)]: stored,
      });
      this.broadcast({ type: "media.track.available", track: stored });
    }
    return result.response;
  }

  private async subscribeTracks(identity: InternalIdentity, request: Request): Promise<Response> {
    const input = SubscribeTracksRequestSchema.parse(await readJson(request));
    if (!(await this.ownsSession(identity.clientId, input.sessionId))) {
      return errorResponse(403, "SESSION_NOT_OWNED", "The media session does not belong to this client.");
    }
    for (const track of input.tracks) {
      const stored = await this.ctx.storage.get<StoredPublishedTrack>(
        trackKey(track.sessionId, track.trackName),
      );
      if (!stored) {
        return errorResponse(403, "TRACK_NOT_AUTHORIZED", "The requested track is not registered in this room.");
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

  private async renegotiate(identity: InternalIdentity, request: Request): Promise<Response> {
    const input = RenegotiateRequestSchema.parse(await readJson(request));
    if (!(await this.ownsSession(identity.clientId, input.sessionId))) {
      return errorResponse(403, "SESSION_NOT_OWNED", "The media session does not belong to this client.");
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

  private async closeTracks(identity: InternalIdentity, request: Request): Promise<Response> {
    const input = CloseTracksRequestSchema.parse(await readJson(request));
    if (!(await this.ownsSession(identity.clientId, input.sessionId))) {
      return errorResponse(403, "SESSION_NOT_OWNED", "The media session does not belong to this client.");
    }

    const ownedPublished: StoredPublishedTrack[] = [];
    for (const track of input.tracks) {
      const stored = await this.ctx.storage.get<StoredPublishedTrack>(midKey(input.sessionId, track.mid));
      if (stored && stored.ownerClientId !== identity.clientId) {
        return errorResponse(403, "TRACK_NOT_OWNED", "A published track belongs to another client.");
      }
      if (stored) ownedPublished.push(stored);
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

    for (const stored of ownedPublished) {
      await this.deletePublishedTrack(stored);
    }
    return result.response;
  }

  private async ownsSession(clientId: string, sessionId: string): Promise<boolean> {
    const record = await this.ctx.storage.get<MediaSessionRecord>(sessionKey(sessionId));
    return record?.clientId === clientId;
  }

  private async listPublishedTracks(): Promise<PublishedAudioRef[]> {
    const stored = await this.ctx.storage.list<StoredPublishedTrack>({ prefix: TRACK_PREFIX });
    return [...stored.values()].map((track) => ({
      ownerClientId: track.ownerClientId,
      sessionId: track.sessionId,
      trackName: track.trackName,
      mid: track.mid,
      kind: track.kind,
    }));
  }

  private async deletePublishedTrack(stored: StoredPublishedTrack): Promise<void> {
    await this.ctx.storage.delete([
      trackKey(stored.sessionId, stored.trackName),
      midKey(stored.sessionId, stored.mid),
    ]);
    this.broadcast({
      type: "media.track.closed",
      ownerClientId: stored.ownerClientId,
      sessionId: stored.sessionId,
      trackName: stored.trackName,
    });
  }

  private async cleanupClientMedia(clientId: string): Promise<void> {
    const sessions = await this.ctx.storage.list<MediaSessionRecord>({ prefix: SESSION_PREFIX });
    const tracks = await this.ctx.storage.list<StoredPublishedTrack>({ prefix: TRACK_PREFIX });
    const ownedTracks = [...tracks.values()].filter((track) => track.ownerClientId === clientId);

    for (const track of ownedTracks) {
      try {
        await this.callRealtime(
          `/sessions/${encodeURIComponent(track.sessionId)}/tracks/close`,
          "PUT",
          { tracks: [{ mid: track.mid }], force: true },
        );
      } catch {
        // Realtime will garbage collect an inactive track; local registry cleanup must still happen.
      }
      await this.deletePublishedTrack(track);
    }

    const ownedSessionKeys = [...sessions.entries()]
      .filter(([, record]) => record.clientId === clientId)
      .map(([key]) => key);
    if (ownedSessionKeys.length > 0) await this.ctx.storage.delete(ownedSessionKeys);
  }

  private async callRealtime(
    path: string,
    method: "POST" | "PUT",
    body?: unknown,
  ): Promise<{ response: Response; json: unknown }> {
    if (!this.env.CLOUDFLARE_REALTIME_APP_ID || !this.env.CLOUDFLARE_REALTIME_APP_SECRET) {
      const response = errorResponse(
        503,
        "REALTIME_NOT_CONFIGURED",
        "Cloudflare Realtime credentials are not configured on the Worker.",
      );
      return { response, json: null };
    }

    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(this.env.CLOUDFLARE_REALTIME_APP_ID)}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.env.CLOUDFLARE_REALTIME_APP_SECRET}`,
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
    const response = new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
    return { response, json };
  }
}
