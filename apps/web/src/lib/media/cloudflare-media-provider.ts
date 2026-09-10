import {
  AUDIO_MAX_BITRATE_BPS,
  RealtimeResponseSchema,
  VIDEO_MAX_BITRATE_BPS,
  type MediaKind,
  type PublishedTrack,
  type RealtimeResponse,
} from "@virtual-office/shared";

import {
  remoteKey,
  type MediaProvider,
  type MediaProviderCallbacks,
  type RemoteTrackRef,
} from "./media-provider";
import { OperationQueue } from "./operation-queue";
import {
  applySfuNegotiation,
  describeSessionDescription,
  isPeerTransportConnected,
  isRecoverableSfuError,
  preferVp8SendCodec,
  rollbackLocalOffer,
  waitForPeerTransport,
} from "./sfu-negotiation";
import {
  assertValidSubscribeResponse,
  midsFromSubscribeResponse,
  partitionSubscribeRefs,
  shouldRecreateRecvOnSubscribeError,
  subscribeNeedsNegotiation,
} from "./subscribe-response";
import { hardStopLocalTrack } from "./track-lifecycle";
import type { MediaDiagnosticsCollector } from "@/lib/spatial-debug/media-diagnostics-collector";

interface PublishedLocal {
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
  trackName: string;
  mid: string;
  kind: MediaKind;
}

interface SfuLink {
  peerConnection: RTCPeerConnection;
  sessionId: string;
}

export interface TicketSource {
  (): Promise<{ ticket: string; mediaBaseUrl: string }>;
}

function parseRealtime(value: unknown): RealtimeResponse {
  const response = RealtimeResponseSchema.parse(value);
  if (response.errorCode) {
    throw new Error(response.errorDescription ?? response.errorCode);
  }
  return response;
}

async function applySenderBitrate(
  sender: RTCRtpSender,
  kind: MediaKind,
): Promise<void> {
  try {
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0] = {
      ...parameters.encodings[0],
      maxBitrate:
        kind === "video" ? VIDEO_MAX_BITRATE_BPS : AUDIO_MAX_BITRATE_BPS,
    };
    await sender.setParameters(parameters);
  } catch {
    // Firefox may reject setParameters until the sender is fully negotiated.
  }
}

/**
 * Cloudflare Realtime adapter using the official echo pattern: one send-only
 * session and one receive-only session. Mixing both on a single
 * RTCPeerConnection makes Chrome reject the SFU answer with
 * "Failed to set remote video description send parameters".
 */
export class CloudflareMediaProvider implements MediaProvider {
  private send: SfuLink | null = null;
  private recv: SfuLink | null = null;
  private cachedAuth: { ticket: string; mediaBaseUrl: string } | null = null;
  private readonly published = new Map<MediaKind, PublishedLocal>();
  private readonly pendingRemote = new Map<string, RemoteTrackRef>();
  private readonly remoteTracks = new Map<
    string,
    {
      ref: RemoteTrackRef;
      track: MediaStreamTrack;
      transceiver: RTCRtpTransceiver;
    }
  >();
  private readonly sendQueue = new OperationQueue();
  private readonly recvQueue = new OperationQueue();
  private readonly subscribingKeys = new Set<string>();
  private readonly awaitingTrackKeys = new Set<string>();
  private readonly releasingKeys = new Set<string>();
  private sendRepairCooldownUntil = 0;
  private lastPublishAt = 0;

  constructor(
    private readonly ticketSource: TicketSource,
    private readonly selfUserId: string,
    private readonly callbacks: MediaProviderCallbacks,
    private readonly diagnostics: MediaDiagnosticsCollector | null = null,
  ) {}

  getSendPeerConnection(): RTCPeerConnection | null {
    return this.send?.peerConnection ?? null;
  }

  getRecvPeerConnection(): RTCPeerConnection | null {
    return this.recv?.peerConnection ?? null;
  }

  getPublishedLocal(kind: MediaKind): PublishedLocal | null {
    return this.published.get(kind) ?? null;
  }

  getPublishedPublication(
    kind: MediaKind,
  ): { sessionId: string; trackName: string } | null {
    const published = this.published.get(kind);
    if (!published || !this.send) return null;
    return {
      sessionId: this.send.sessionId,
      trackName: published.trackName,
    };
  }

  getRemoteTrack(ref: RemoteTrackRef): MediaStreamTrack | null {
    return this.remoteTracks.get(remoteKey(ref))?.track ?? null;
  }

  private clearPendingForRef(ref: RemoteTrackRef): void {
    for (const [mid, pending] of this.pendingRemote.entries()) {
      if (remoteKey(pending) === remoteKey(ref)) {
        this.pendingRemote.delete(mid);
        this.diagnostics?.subscribePendingCleared(ref);
      }
    }
  }

  publishedKinds(): MediaKind[] {
    return [...this.published.keys()];
  }

  isRemoteBound(ref: RemoteTrackRef): boolean {
    const key = remoteKey(ref);
    const remote = this.remoteTracks.get(key);
    if (remote) {
      if (remote.track.readyState === "ended") {
        if (!this.releasingKeys.has(key)) {
          this.releasingKeys.add(key);
          void this.unsubscribe(ref).finally(() => {
            this.releasingKeys.delete(key);
          });
        }
        return false;
      }
      return true;
    }
    if (this.subscribingKeys.has(key) || this.awaitingTrackKeys.has(key)) {
      return true;
    }
    return [...this.pendingRemote.values()].some(
      (pending) => remoteKey(pending) === key,
    );
  }

  private connecting: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.send && this.recv) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const [send, recv] = await Promise.all([
        this.openLink("send"),
        this.openLink("recv"),
      ]);
      this.send = send;
      this.recv = recv;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async openLink(role: "send" | "recv"): Promise<SfuLink> {
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      bundlePolicy: "max-bundle",
    });
    peerConnection.addEventListener("connectionstatechange", () => {
      this.callbacks.onState(`${role}:${peerConnection.connectionState}`);
    });
    if (role === "recv") {
      peerConnection.addEventListener("track", (event) =>
        this.handleRemoteTrack(event),
      );
    }

    const response = parseRealtime(await this.call("session"));
    if (!response.sessionId) {
      throw new Error("Realtime did not return a media session ID");
    }
    return { peerConnection, sessionId: response.sessionId };
  }

  private async applyNegotiation(
    link: SfuLink,
    response: RealtimeResponse,
  ): Promise<void> {
    if (!response.sessionDescription) {
      throw new Error("Realtime omitted the session description");
    }

    await applySfuNegotiation(
      link.peerConnection,
      response.sessionDescription,
      async (sessionDescription) => {
        parseRealtime(
          await this.call("renegotiate", {
            sessionId: link.sessionId,
            sessionDescription,
          }),
        );
      },
    );
  }

  async publish(
    kind: MediaKind,
    track: MediaStreamTrack,
  ): Promise<PublishedTrack> {
    return this.sendQueue.run(async () => {
      try {
        return await this.publishOnce(kind, track);
      } catch (error) {
        if (!isRecoverableSfuError(error)) throw error;
        await this.recreateSendLink();
        return this.publishOnce(kind, track);
      }
    });
  }

  private async recreateSendLink(): Promise<void> {
    const keep = [...this.published.entries()].filter(
      ([, item]) => item.track.readyState === "live",
    );
    for (const [, item] of keep) {
      try {
        await item.transceiver.sender.replaceTrack(null);
      } catch {
        // Sender may already be gone.
      }
    }
    this.published.clear();
    this.send?.peerConnection.close();
    this.send = null;
    this.send = await this.openLink("send");
    for (const [kind, item] of keep) {
      await this.publishOnce(kind, item.track);
    }
  }

  private async publishOnce(
    kind: MediaKind,
    track: MediaStreamTrack,
  ): Promise<PublishedTrack> {
    const link = this.requireSend();
    if (this.published.has(kind)) {
      throw new Error(`A ${kind} track is already published`);
    }
    if (track.readyState !== "live") {
      throw new Error("La pista local se detuvo antes de publicar.");
    }

    this.diagnostics?.publishStep(`${kind}:add-transceiver`);
    const transceiver = link.peerConnection.addTransceiver(track, {
      direction: "sendonly",
    });
    if (kind === "video") preferVp8SendCodec(transceiver);
    try {
      this.diagnostics?.publishStep(`${kind}:create-offer`);
      const offer = await link.peerConnection.createOffer();
      await link.peerConnection.setLocalDescription(offer);
      const mid = transceiver.mid;
      if (!mid) throw new Error("The transceiver has no MID after the offer");
      const trackName = `${kind}-${this.selfUserId}-${crypto.randomUUID()}`;
      this.diagnostics?.publishStep(`${kind}:tracks-publish`);
      const response = parseRealtime(
        await this.call("tracks/publish", {
          sessionId: link.sessionId,
          sessionDescription: describeSessionDescription(
            link.peerConnection.localDescription,
          ),
          tracks: [{ location: "local", mid, trackName, kind }],
        }),
      );
      await this.applyNegotiation(link, response);
      await applySenderBitrate(transceiver.sender, kind);
      this.published.set(kind, {
        track,
        transceiver,
        trackName,
        mid,
        kind,
      });
      this.lastPublishAt = Date.now();
      this.diagnostics?.publishStep(`${kind}:published`);
      // Non-fatal: the track is already registered in the catalog above, so a
      // slow ICE handshake here must not roll back the publish (that would
      // orphan the catalog entry and break every remote subscriber). Ongoing
      // send-transport health is instead handled by repairSendTransportIfNeeded.
      this.diagnostics?.publishStep(`${kind}:await-send-transport`);
      void waitForPeerTransport(link.peerConnection, "send")
        .then(async () => {
          this.diagnostics?.publishStep(`${kind}:send-transport-ready`);
          await this.announcePublishedTracks(link.sessionId);
        })
        .catch((error) => {
          this.diagnostics?.log(
            `${kind}:send-transport-slow ${error instanceof Error ? error.message : String(error)}`,
          );
          void this.announcePublishedTracks(link.sessionId);
        });
      return {
        ownerUserId: this.selfUserId,
        sessionId: link.sessionId,
        trackName,
        mid,
        kind,
      };
    } catch (error) {
      this.diagnostics?.publishError(error);
      await rollbackLocalOffer(link.peerConnection);
      try {
        await transceiver.sender.replaceTrack(null);
      } catch {
        // Sender may already be gone after a failed negotiation.
      }
      try {
        transceiver.stop();
      } catch {
        // Ignore already-stopped transceivers.
      }
      throw error;
    }
  }

  /** Re-register a live local track with the office catalog after a reconnect. */
  async reregister(kind: MediaKind): Promise<void> {
    await this.sendQueue.run(async () => {
      const local = this.published.get(kind);
      const link = this.requireSend();
      if (!local || local.track.readyState !== "live") return;
      if (!local.transceiver.mid) {
        throw new Error("The transceiver has no MID for catalog resync");
      }
      this.diagnostics?.publishStep(`${kind}:catalog-resync`);
      const offer = await link.peerConnection.createOffer();
      await link.peerConnection.setLocalDescription(offer);
      const response = parseRealtime(
        await this.call("tracks/publish", {
          sessionId: link.sessionId,
          sessionDescription: describeSessionDescription(
            link.peerConnection.localDescription,
          ),
          tracks: [
            {
              location: "local",
              mid: local.transceiver.mid,
              trackName: local.trackName,
              kind,
            },
          ],
        }),
      );
      await this.applyNegotiation(link, response);
      this.diagnostics?.publishStep(`${kind}:catalog-resynced`);
    });
  }

  /** Re-broadcast catalog entries once ICE can actually carry audio. */
  private async announcePublishedTracks(sessionId: string): Promise<void> {
    try {
      await this.call("tracks/announce", { sessionId });
      this.diagnostics?.log("publish:catalog-announce");
    } catch (error) {
      this.diagnostics?.log(
        `publish:catalog-announce-error ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async unpublish(kind: MediaKind): Promise<void> {
    await this.sendQueue.run(async () => {
      const published = this.published.get(kind);
      if (!published) return;
      this.published.delete(kind);
      const link = this.requireSend();

      await hardStopLocalTrack({
        track: published.track,
        sender: published.transceiver.sender,
        transceiver: published.transceiver,
      });
      await this.call("tracks/close", {
        sessionId: link.sessionId,
        tracks: [{ mid: published.mid }],
        force: true,
      });
    });
  }

  private async recreateRecvLink(): Promise<void> {
    this.diagnostics?.log("recv:recreate");
    for (const remote of this.remoteTracks.values()) {
      remote.track.stop();
      this.callbacks.onRemoteTrackClosed(remote.ref);
    }
    this.remoteTracks.clear();
    this.pendingRemote.clear();
    this.awaitingTrackKeys.clear();
    this.recv?.peerConnection.close();
    this.recv = await this.openLink("recv");
  }

  private mapSubscribeMids(
    refs: RemoteTrackRef[],
    response: RealtimeResponse,
  ): void {
    const returned = response.tracks ?? [];
    const unmatchedMids: string[] = [];

    for (const track of returned) {
      if (!track.mid) continue;
      const ref = refs.find((item) => item.trackName === track.trackName);
      if (ref) {
        this.pendingRemote.set(track.mid, ref);
        this.diagnostics?.log(
          `subscribe:pending mid=${track.mid.slice(0, 8)} track=${ref.kind}`,
        );
        continue;
      }
      unmatchedMids.push(track.mid);
    }

    const unmatchedRefs = refs.filter(
      (ref) =>
        !returned.some(
          (track) => track.trackName === ref.trackName && track.mid,
        ),
    );
    for (let index = 0; index < unmatchedMids.length; index += 1) {
      const mid = unmatchedMids[index];
      const ref = unmatchedRefs[index];
      if (!mid || !ref) break;
      this.pendingRemote.set(mid, ref);
      this.diagnostics?.log(
        `subscribe:pending mid=${mid.slice(0, 8)} track=${ref.kind}`,
      );
    }
  }

  private async subscribeOnceBatch(refs: RemoteTrackRef[]): Promise<void> {
    if (refs.length === 0) return;
    const link = this.requireRecv();
    for (const ref of refs) {
      this.diagnostics?.subscribeRequested(ref);
      this.awaitingTrackKeys.add(remoteKey(ref));
    }
    const response = parseRealtime(
      await this.call("tracks/subscribe", {
        sessionId: link.sessionId,
        tracks: refs.map((ref) => ({
          location: "remote" as const,
          sessionId: ref.sessionId,
          trackName: ref.trackName,
        })),
      }),
    );
    const midsPreview = midsFromSubscribeResponse(response);
    this.diagnostics?.log(
      `subscribe:response mids=${midsPreview.length} sdp=${Boolean(response.sessionDescription)} reneg=${Boolean(response.requiresImmediateRenegotiation)} count=${refs.length}`,
    );
    assertValidSubscribeResponse(response);
    this.mapSubscribeMids(refs, response);
    if (subscribeNeedsNegotiation(response)) {
      this.diagnostics?.log("subscribe:negotiate-start");
      await this.applyNegotiation(link, response);
      this.diagnostics?.log("subscribe:negotiate-ok");
    }
    for (const ref of refs) {
      this.diagnostics?.subscribeSuccess(ref);
      this.scheduleAwaitingTrackTimeout(ref);
    }
  }

  private scheduleAwaitingTrackTimeout(ref: RemoteTrackRef): void {
    const key = remoteKey(ref);
    setTimeout(() => {
      if (!this.awaitingTrackKeys.has(key)) return;
      if (this.remoteTracks.has(key)) return;
      this.awaitingTrackKeys.delete(key);
      this.clearPendingForRef(ref);
      this.diagnostics?.log(`subscribe:awaiting-timeout ${ref.kind}`);
    }, 8_000);
  }

  async repairSendTransportIfNeeded(): Promise<void> {
    if (Date.now() < this.sendRepairCooldownUntil) return;
    const link = this.send;
    if (!link || this.published.size === 0) return;
    if (isPeerTransportConnected(link.peerConnection)) return;
    const ice = link.peerConnection.iceConnectionState;
    const conn = link.peerConnection.connectionState;
    if (ice === "checking" || conn === "connecting") return;
    // Give a fresh handshake time to converge before tearing it down; ICE
    // can legitimately take longer than one interval tick on real networks.
    if (Date.now() - this.lastPublishAt < 15_000) return;

    this.sendRepairCooldownUntil = Date.now() + 10_000;
    this.diagnostics?.log(`send:repair ice=${ice} conn=${conn}`);
    await this.sendQueue.run(async () => {
      await this.recreateSendLink();
    });
  }

  async subscribe(ref: RemoteTrackRef): Promise<void> {
    await this.subscribeMany([ref]);
  }

  async subscribeMany(refs: RemoteTrackRef[]): Promise<void> {
    await this.recvQueue.run(async () => {
      const pending = refs.filter((ref) => {
        if (ref.ownerUserId === this.selfUserId) return false;
        if (this.isRemoteBound(ref)) return false;
        const key = remoteKey(ref);
        if (this.subscribingKeys.has(key)) return false;
        return true;
      });
      if (pending.length === 0) return;

      const { audio, video } = partitionSubscribeRefs(pending);
      const batches = [audio, video].filter((group) => group.length > 0);
      const failures: Array<{ refs: RemoteTrackRef[]; error: unknown }> = [];

      for (const group of batches) {
        for (const ref of group) {
          this.subscribingKeys.add(remoteKey(ref));
        }
        const clearGroup = () => {
          for (const ref of group) {
            this.clearPendingForRef(ref);
            this.awaitingTrackKeys.delete(remoteKey(ref));
          }
        };
        try {
          try {
            await this.subscribeOnceBatch(group);
          } catch (error) {
            clearGroup();
            if (!shouldRecreateRecvOnSubscribeError(error)) throw error;
            this.diagnostics?.log(
              `subscribe:recover ${error instanceof Error ? error.message : String(error)}`,
            );
            await this.recreateRecvLink();
            for (const ref of group) {
              this.awaitingTrackKeys.add(remoteKey(ref));
            }
            await this.subscribeOnceBatch(group);
          }
        } catch (error) {
          clearGroup();
          if (isRecoverableSfuError(error)) {
            this.diagnostics?.log("subscribe:sfu-session-expired");
          }
          failures.push({ refs: group, error });
        } finally {
          for (const ref of group) {
            this.subscribingKeys.delete(remoteKey(ref));
          }
        }
      }

      if (failures.length === 0) return;
      for (const failure of failures) {
        for (const ref of failure.refs) {
          this.diagnostics?.subscribeFailure(ref, failure.error);
        }
      }
      throw failures[0]?.error;
    });
  }

  async unsubscribe(ref: RemoteTrackRef): Promise<void> {
    await this.recvQueue.run(async () => {
      const key = remoteKey(ref);
      this.clearPendingForRef(ref);
      const remote = this.remoteTracks.get(key);
      if (!remote) return;
      const link = this.requireRecv();
      const mid = remote.transceiver.mid;
      if (mid) {
        await this.call("tracks/close", {
          sessionId: link.sessionId,
          tracks: [{ mid }],
          force: true,
        }).catch((error) => {
          this.diagnostics?.log(
            `tracks-close:error ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      remote.track.stop();
      remote.transceiver.stop();
      this.remoteTracks.delete(key);
      this.callbacks.onRemoteTrackClosed(remote.ref);
    });
  }

  async disconnect(): Promise<void> {
    for (const kind of [...this.published.keys()]) {
      await this.unpublish(kind).catch(() => undefined);
    }
    await this.recvQueue.run(async () => {
      for (const remote of this.remoteTracks.values()) {
        remote.track.stop();
        this.callbacks.onRemoteTrackClosed(remote.ref);
      }
      this.remoteTracks.clear();
      this.pendingRemote.clear();
    });
    this.cachedAuth = null;
    this.send?.peerConnection.close();
    this.recv?.peerConnection.close();
    this.send = null;
    this.recv = null;
  }

  private handleRemoteTrack(event: RTCTrackEvent): void {
    let mid = event.transceiver.mid;
    let ref = mid ? this.pendingRemote.get(mid) : undefined;
    if (!ref) {
      for (const [pendingMid, pendingRef] of this.pendingRemote.entries()) {
        if (pendingRef.kind === event.track.kind) {
          ref = pendingRef;
          mid = pendingMid;
          break;
        }
      }
    }
    if (!ref || !mid) {
      const transceiverMid = event.transceiver.mid;
      for (const remote of this.remoteTracks.values()) {
        if (remote.ref.kind !== event.track.kind) continue;
        if (
          remote.transceiver !== event.transceiver &&
          transceiverMid &&
          remote.transceiver.mid !== transceiverMid
        ) {
          continue;
        }
        if (event.track.readyState !== "live") {
          this.diagnostics?.log(
            `orphan-track:dead ${remote.ref.kind} user=${remote.ref.ownerUserId.slice(0, 8)} rs=${event.track.readyState}`,
          );
          return;
        }
        remote.track = event.track;
        this.diagnostics?.log(
          `orphan-track:rebind ${remote.ref.kind} user=${remote.ref.ownerUserId.slice(0, 8)} mid=${transceiverMid?.slice(0, 6) ?? "none"}`,
        );
        this.callbacks.onRemoteTrack(remote.ref, event.track);
        return;
      }
      this.diagnostics?.log(
        `orphan-track mid=${mid?.slice(0, 6) ?? transceiverMid?.slice(0, 6) ?? "none"} kind=${event.track.kind}`,
      );
      return;
    }
    if (event.track.readyState !== "live") {
      this.pendingRemote.delete(mid);
      this.awaitingTrackKeys.delete(remoteKey(ref));
      this.diagnostics?.log(
        `remoteTrack:dead-on-arrival ${ref.kind} user=${ref.ownerUserId.slice(0, 8)} rs=${event.track.readyState}`,
      );
      return;
    }
    this.pendingRemote.delete(mid);
    this.awaitingTrackKeys.delete(remoteKey(ref));
    this.remoteTracks.set(remoteKey(ref), {
      ref,
      track: event.track,
      transceiver: event.transceiver,
    });
    const logTrackLifecycle = (label: string) => {
      this.diagnostics?.log(
        `track:${label} ${ref.kind} user=${ref.ownerUserId.slice(0, 8)} rs=${event.track.readyState} muted=${event.track.muted}`,
      );
    };
    event.track.addEventListener("mute", () => logTrackLifecycle("mute"));
    event.track.addEventListener("unmute", () => logTrackLifecycle("unmute"));
    event.track.addEventListener(
      "ended",
      () => {
        logTrackLifecycle("ended");
        this.remoteTracks.delete(remoteKey(ref));
        this.callbacks.onRemoteTrackClosed(ref);
      },
      { once: true },
    );
    this.callbacks.onRemoteTrack(ref, event.track);
    this.diagnostics?.remoteTrack(ref, event.track);
  }

  private async call(action: string, body?: unknown): Promise<unknown> {
    const auth = this.cachedAuth ?? (await this.ticketSource());
    this.cachedAuth = auth;
    const execute = async (ticket: string) =>
      fetch(`${auth.mediaBaseUrl}/${action}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ticket}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    let response = await execute(auth.ticket);
    if (response.status === 401) {
      const refreshed = await this.ticketSource();
      this.cachedAuth = refreshed;
      response = await execute(refreshed.ticket);
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = payload as { message?: string; error?: string } | null;
      throw new Error(
        error?.message ??
          error?.error ??
          `Media call failed (${response.status})`,
      );
    }
    return payload;
  }

  private requireSend(): SfuLink {
    if (!this.send) throw new Error("The SFU send session is not ready");
    return this.send;
  }

  private requireRecv(): SfuLink {
    if (!this.recv) throw new Error("The SFU receive session is not ready");
    return this.recv;
  }
}
