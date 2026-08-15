import type { PublishedAudioRef } from "../shared/protocol";
import { RealtimeResponseSchema, type RealtimeResponse } from "../shared/realtime";
import { apiJson } from "./api";
import { hardStopLocalTrack } from "./media-lifecycle";

interface PublishedLocalAudio {
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
  trackName: string;
  mid: string;
}

interface CandidatePairStats extends RTCStats {
  type: "candidate-pair";
  state: string;
  nominated?: boolean;
  selected?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
  currentRoundTripTime?: number;
}

interface AudioRtpStats extends RTCStats {
  kind?: string;
  bytesSent?: number;
  bytesReceived?: number;
}

export interface MediaDiagnostics {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  currentRoundTripTimeMs: number | null;
  bytesSent: number;
  bytesReceived: number;
  localTracks: number;
  remoteTracks: number;
}

interface AudioClientCallbacks {
  onState(message: string): void;
  onRemoteTrack(ref: PublishedAudioRef, track: MediaStreamTrack): void;
  onRemoteTrackClosed(ref: PublishedAudioRef): void;
}

function sessionDescription(description: RTCSessionDescription | RTCSessionDescriptionInit | null) {
  if (!description?.sdp || !description.type) throw new Error("WebRTC did not produce an SDP description");
  if (description.type !== "offer" && description.type !== "answer") {
    throw new Error(`Unsupported SDP type: ${description.type}`);
  }
  return { sdp: description.sdp, type: description.type };
}

function parsedRealtimeResponse(value: unknown): RealtimeResponse {
  const response = RealtimeResponseSchema.parse(value);
  if (response.errorCode) throw new Error(response.errorDescription ?? response.errorCode);
  return response;
}

function remoteKey(ref: PublishedAudioRef): string {
  return `${ref.sessionId}:${ref.trackName}`;
}

export class SfuAudioClient {
  private peerConnection: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private published: PublishedLocalAudio | null = null;
  private readonly pendingRemote = new Map<string, PublishedAudioRef>();
  private readonly remoteTracks = new Map<string, { ref: PublishedAudioRef; track: MediaStreamTrack }>();
  private busy = false;

  constructor(
    private readonly ticket: string,
    private readonly clientId: string,
    private readonly callbacks: AudioClientCallbacks,
  ) {}

  get isPublished(): boolean {
    return this.published !== null;
  }

  get activeLocalTrackCount(): number {
    return this.published?.track.readyState === "live" ? 1 : 0;
  }

  async initialize(): Promise<void> {
    if (this.peerConnection) return;
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      bundlePolicy: "max-bundle",
    });
    this.peerConnection.addEventListener("connectionstatechange", () => {
      this.callbacks.onState(`SFU ${this.peerConnection?.connectionState ?? "closed"}`);
    });
    this.peerConnection.addEventListener("track", (event) => this.handleRemoteTrack(event));

    const response = parsedRealtimeResponse(
      await apiJson("/api/media/session", { ticket: this.ticket }),
    );
    if (!response.sessionId) throw new Error("Realtime did not return a media session ID");
    this.sessionId = response.sessionId;
    this.callbacks.onState("Sesión SFU preparada sin pistas locales");
  }

  async publishAudio(): Promise<void> {
    if (this.busy || this.published) return;
    const peerConnection = this.requirePeerConnection();
    const sessionId = this.requireSessionId();
    this.busy = true;
    let localTrack: MediaStreamTrack | null = null;
    let transceiver: RTCRtpTransceiver | null = null;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      localTrack = stream.getAudioTracks()[0] ?? null;
      if (!localTrack) throw new Error("No audio track was returned by the browser");
      transceiver = peerConnection.addTransceiver(localTrack, { direction: "sendonly" });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const mid = transceiver.mid;
      if (!mid) throw new Error("The audio transceiver has no MID after creating an offer");
      const trackName = `audio-${this.clientId}-${crypto.randomUUID()}`;
      const response = parsedRealtimeResponse(
        await apiJson("/api/media/tracks/publish", {
          ticket: this.ticket,
          body: {
            sessionId,
            sessionDescription: sessionDescription(peerConnection.localDescription),
            tracks: [{ location: "local", mid, trackName, kind: "audio" }],
          },
        }),
      );
      if (!response.sessionDescription) throw new Error("Realtime omitted the publish SDP answer");
      await peerConnection.setRemoteDescription(response.sessionDescription);
      this.published = { track: localTrack, transceiver, trackName, mid };
      this.callbacks.onState("Micrófono publicado");
    } catch (error) {
      if (localTrack) {
        await hardStopLocalTrack({
          track: localTrack,
          ...(transceiver ? { sender: transceiver.sender, transceiver } : {}),
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async unpublishAudio(): Promise<void> {
    if (this.busy || !this.published) return;
    const sessionId = this.requireSessionId();
    const published = this.published;
    this.published = null;
    this.busy = true;

    try {
      await hardStopLocalTrack({
        track: published.track,
        sender: published.transceiver.sender,
        transceiver: published.transceiver,
      });
      parsedRealtimeResponse(
        await apiJson("/api/media/tracks/close", {
          ticket: this.ticket,
          body: {
            sessionId,
            tracks: [{ mid: published.mid }],
            force: true,
          },
        }),
      );
      this.callbacks.onState("Micrófono OFF: pista cerrada y dispositivo liberado");
    } finally {
      this.busy = false;
    }
  }

  async subscribe(ref: PublishedAudioRef): Promise<void> {
    if (ref.ownerClientId === this.clientId) return;
    const key = remoteKey(ref);
    if (this.remoteTracks.has(key) || [...this.pendingRemote.values()].some((item) => remoteKey(item) === key)) {
      return;
    }
    const peerConnection = this.requirePeerConnection();
    const sessionId = this.requireSessionId();
    const response = parsedRealtimeResponse(
      await apiJson("/api/media/tracks/subscribe", {
        ticket: this.ticket,
        body: {
          sessionId,
          tracks: [{ location: "remote", sessionId: ref.sessionId, trackName: ref.trackName }],
        },
      }),
    );
    for (const track of response.tracks ?? []) {
      if (track.mid) this.pendingRemote.set(track.mid, ref);
    }

    if (response.requiresImmediateRenegotiation) {
      if (!response.sessionDescription) throw new Error("Realtime omitted the subscription SDP offer");
      await peerConnection.setRemoteDescription(response.sessionDescription);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      parsedRealtimeResponse(
        await apiJson("/api/media/renegotiate", {
          ticket: this.ticket,
          body: {
            sessionId,
            sessionDescription: sessionDescription(peerConnection.localDescription),
          },
        }),
      );
    }
  }

  closeRemote(ref: PublishedAudioRef): void {
    const key = remoteKey(ref);
    const remote = this.remoteTracks.get(key);
    if (!remote) return;
    remote.track.stop();
    this.remoteTracks.delete(key);
    this.callbacks.onRemoteTrackClosed(ref);
  }

  async diagnostics(): Promise<MediaDiagnostics> {
    const peerConnection = this.requirePeerConnection();
    const reports = await peerConnection.getStats();
    let selectedPair: CandidatePairStats | null = null;
    let bytesSent = 0;
    let bytesReceived = 0;
    for (const report of reports.values()) {
      if (report.type === "candidate-pair") {
        const pair = report as CandidatePairStats;
        if (pair.state === "succeeded" && (pair.nominated || pair.selected)) selectedPair = pair;
      }
      if (report.type === "outbound-rtp") {
        const outbound = report as AudioRtpStats;
        if (outbound.kind === "audio") bytesSent += outbound.bytesSent ?? 0;
      }
      if (report.type === "inbound-rtp") {
        const inbound = report as AudioRtpStats;
        if (inbound.kind === "audio") bytesReceived += inbound.bytesReceived ?? 0;
      }
    }
    const localCandidate = selectedPair?.localCandidateId
      ? reports.get(selectedPair.localCandidateId)
      : undefined;
    const remoteCandidate = selectedPair?.remoteCandidateId
      ? reports.get(selectedPair.remoteCandidateId)
      : undefined;
    return {
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      localCandidateType: localCandidate?.candidateType ?? null,
      remoteCandidateType: remoteCandidate?.candidateType ?? null,
      currentRoundTripTimeMs:
        typeof selectedPair?.currentRoundTripTime === "number"
          ? Math.round(selectedPair.currentRoundTripTime * 1_000)
          : null,
      bytesSent,
      bytesReceived,
      localTracks: this.activeLocalTrackCount,
      remoteTracks: this.remoteTracks.size,
    };
  }

  async disconnect(): Promise<void> {
    await this.unpublishAudio().catch(() => undefined);
    for (const remote of this.remoteTracks.values()) {
      remote.track.stop();
      this.callbacks.onRemoteTrackClosed(remote.ref);
    }
    this.remoteTracks.clear();
    this.peerConnection?.close();
    this.peerConnection = null;
    this.sessionId = null;
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

  private requirePeerConnection(): RTCPeerConnection {
    if (!this.peerConnection) throw new Error("The SFU session is not initialized");
    return this.peerConnection;
  }

  private requireSessionId(): string {
    if (!this.sessionId) throw new Error("The SFU session ID is unavailable");
    return this.sessionId;
  }
}
