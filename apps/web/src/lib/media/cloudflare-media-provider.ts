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
import { hardStopLocalTrack } from "./track-lifecycle";

interface PublishedLocal {
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
  trackName: string;
  mid: string;
  kind: MediaKind;
}

export interface TicketSource {
  (): Promise<{ ticket: string; mediaBaseUrl: string }>;
}

function describe(
  description: RTCSessionDescription | RTCSessionDescriptionInit | null,
) {
  if (!description?.sdp || !description.type) {
    throw new Error("WebRTC did not produce an SDP description");
  }
  if (description.type !== "offer" && description.type !== "answer") {
    throw new Error(`Unsupported SDP type: ${description.type}`);
  }
  return { sdp: description.sdp, type: description.type };
}

function parseRealtime(value: unknown): RealtimeResponse {
  const response = RealtimeResponseSchema.parse(value);
  if (response.errorCode) {
    throw new Error(response.errorDescription ?? response.errorCode);
  }
  return response;
}

/**
 * Cloudflare Realtime SFU adapter.
 *
 * Every negotiation runs through a single promise chain: the Sprint 0 spike
 * proved that concurrent publish/subscribe operations on one RTCPeerConnection
 * fail intermittently once a third participant joins.
 */
export class CloudflareMediaProvider implements MediaProvider {
  private peerConnection: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private readonly published = new Map<MediaKind, PublishedLocal>();
  private readonly pendingRemote = new Map<string, RemoteTrackRef>();
  private readonly remoteTracks = new Map<
    string,
    { ref: RemoteTrackRef; track: MediaStreamTrack }
  >();
  private readonly queue = new OperationQueue();

  constructor(
    private readonly ticketSource: TicketSource,
    private readonly selfUserId: string,
    private readonly callbacks: MediaProviderCallbacks,
  ) {}

  publishedKinds(): MediaKind[] {
    return [...this.published.keys()];
  }

  async connect(): Promise<void> {
    await this.enqueue(async () => {
      if (this.peerConnection) return;
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
      });
      peerConnection.addEventListener("connectionstatechange", () => {
        this.callbacks.onState(peerConnection.connectionState);
      });
      peerConnection.addEventListener("track", (event) =>
        this.handleRemoteTrack(event),
      );
      this.peerConnection = peerConnection;

      const response = parseRealtime(await this.call("session"));
      if (!response.sessionId) {
        throw new Error("Realtime did not return a media session ID");
      }
      this.sessionId = response.sessionId;
    });
  }

  async publish(
    kind: MediaKind,
    track: MediaStreamTrack,
  ): Promise<PublishedTrack> {
    return this.enqueue(async () => {
      const peerConnection = this.requirePeerConnection();
      const sessionId = this.requireSessionId();
      if (this.published.has(kind)) {
        throw new Error(`A ${kind} track is already published`);
      }

      const transceiver = peerConnection.addTransceiver(track, {
        direction: "sendonly",
        sendEncodings: [
          {
            maxBitrate:
              kind === "video" ? VIDEO_MAX_BITRATE_BPS : AUDIO_MAX_BITRATE_BPS,
          },
        ],
      });
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        const mid = transceiver.mid;
        if (!mid) throw new Error("The transceiver has no MID after the offer");
        const trackName = `${kind}-${this.selfUserId}-${crypto.randomUUID()}`;
        const response = parseRealtime(
          await this.call("tracks/publish", {
            sessionId,
            sessionDescription: describe(peerConnection.localDescription),
            tracks: [{ location: "local", mid, trackName, kind }],
          }),
        );
        if (!response.sessionDescription) {
          throw new Error("Realtime omitted the publish SDP answer");
        }
        await peerConnection.setRemoteDescription(response.sessionDescription);
        this.published.set(kind, {
          track,
          transceiver,
          trackName,
          mid,
          kind,
        });
        return {
          ownerUserId: this.selfUserId,
          sessionId,
          trackName,
          mid,
          kind,
        };
      } catch (error) {
        await hardStopLocalTrack({
          track,
          sender: transceiver.sender,
          transceiver,
        }).catch(() => undefined);
        throw error;
      }
    });
  }

  async unpublish(kind: MediaKind): Promise<void> {
    await this.enqueue(async () => {
      const published = this.published.get(kind);
      if (!published) return;
      this.published.delete(kind);
      const sessionId = this.requireSessionId();

      await hardStopLocalTrack({
        track: published.track,
        sender: published.transceiver.sender,
        transceiver: published.transceiver,
      });
      await this.call("tracks/close", {
        sessionId,
        tracks: [{ mid: published.mid }],
        force: true,
      });
    });
  }

  async subscribe(ref: RemoteTrackRef): Promise<void> {
    await this.enqueue(async () => {
      if (ref.ownerUserId === this.selfUserId) return;
      const key = remoteKey(ref);
      if (
        this.remoteTracks.has(key) ||
        [...this.pendingRemote.values()].some(
          (pending) => remoteKey(pending) === key,
        )
      ) {
        return;
      }
      const peerConnection = this.requirePeerConnection();
      const sessionId = this.requireSessionId();
      const response = parseRealtime(
        await this.call("tracks/subscribe", {
          sessionId,
          tracks: [
            {
              location: "remote",
              sessionId: ref.sessionId,
              trackName: ref.trackName,
            },
          ],
        }),
      );
      for (const track of response.tracks ?? []) {
        if (track.mid) this.pendingRemote.set(track.mid, ref);
      }
      if (!response.requiresImmediateRenegotiation) return;
      if (!response.sessionDescription) {
        throw new Error("Realtime omitted the subscription SDP offer");
      }
      await peerConnection.setRemoteDescription(response.sessionDescription);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      parseRealtime(
        await this.call("renegotiate", {
          sessionId,
          sessionDescription: describe(peerConnection.localDescription),
        }),
      );
    });
  }

  async unsubscribe(ref: RemoteTrackRef): Promise<void> {
    await this.enqueue(async () => {
      const key = remoteKey(ref);
      const remote = this.remoteTracks.get(key);
      if (!remote) return;
      remote.track.stop();
      this.remoteTracks.delete(key);
      this.callbacks.onRemoteTrackClosed(remote.ref);
    });
  }

  async disconnect(): Promise<void> {
    for (const kind of [...this.published.keys()]) {
      await this.unpublish(kind).catch(() => undefined);
    }
    await this.enqueue(async () => {
      for (const remote of this.remoteTracks.values()) {
        remote.track.stop();
        this.callbacks.onRemoteTrackClosed(remote.ref);
      }
      this.remoteTracks.clear();
      this.pendingRemote.clear();
      this.peerConnection?.close();
      this.peerConnection = null;
      this.sessionId = null;
    });
  }

  private handleRemoteTrack(event: RTCTrackEvent): void {
    const mid = event.transceiver.mid;
    if (!mid) return;
    const ref = this.pendingRemote.get(mid);
    if (!ref) return;
    this.pendingRemote.delete(mid);
    this.remoteTracks.set(remoteKey(ref), { ref, track: event.track });
    event.track.addEventListener(
      "ended",
      () => {
        this.remoteTracks.delete(remoteKey(ref));
        this.callbacks.onRemoteTrackClosed(ref);
      },
      { once: true },
    );
    this.callbacks.onRemoteTrack(ref, event.track);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return this.queue.run(operation);
  }

  private async call(action: string, body?: unknown): Promise<unknown> {
    const { ticket, mediaBaseUrl } = await this.ticketSource();
    const response = await fetch(`${mediaBaseUrl}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ticket}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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

  private requirePeerConnection(): RTCPeerConnection {
    if (!this.peerConnection) throw new Error("The SFU session is not ready");
    return this.peerConnection;
  }

  private requireSessionId(): string {
    if (!this.sessionId) throw new Error("The SFU session ID is unavailable");
    return this.sessionId;
  }
}
