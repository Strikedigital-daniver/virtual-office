"use client";

import {
  effectiveAudioGain,
  effectiveWorldVideoOpacity,
  TILE_SIZE,
  type MediaKind,
  type ProximityZone,
  type PublishedTrack,
  type SpatialAccessClass,
} from "@virtual-office/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProximityDebugRow } from "@/components/proximity-media-debug";
import {
  ProximityMediaController,
  type WorldPosition,
} from "@/lib/proximity/proximity-media-controller";
import {
  SpatialAudioMixer,
  syncSpatialAudioGraph,
} from "@/lib/proximity/spatial-audio-mixer";
import {
  SPATIAL_AUDIO_UNLOCK_EVENT,
  type HtmlAudioPlaybackState,
} from "@/lib/proximity/html-audio-playback";
import { spatialDebugEnabled } from "@/lib/spatial-debug/enabled";
import type { MediaDiagnosticsSnapshot } from "@/lib/spatial-debug/media-diagnostics";
import { MediaDiagnosticsCollector } from "@/lib/spatial-debug/media-diagnostics-collector";
import { emptyLocalAudioDiagnostics } from "@/lib/spatial-debug/media-diagnostics";

import { CloudflareMediaProvider } from "./cloudflare-media-provider";
import { captureLocalTrack, classifyMediaDeviceError } from "./local-media";
import {
  remoteKey,
  type RemoteTrackRef,
  isCatalogRegistrationError,
  isMediaAuthorizationDenyError,
  isStaleSfuPublicationError,
} from "./media-provider";
import { findStaleRemoteRefs } from "./stale-remote-tracks";
import {
  partitionSubscribeRefs,
  SubscribeResponseError,
} from "./subscribe-response";

export type DeviceStatus = "off" | "starting" | "on" | "failed";

export interface RemoteMedia {
  key: string;
  ref: RemoteTrackRef;
  stream: MediaStream;
  displayName: string;
  audioGain: number;
  videoOpacity: number;
  proximityZone: ProximityZone;
  subscribed: boolean;
}

interface Ticket {
  ticket: string;
  mediaBaseUrl: string;
  userId: string;
  accessClass: SpatialAccessClass;
}

function trackRef(track: PublishedTrack): RemoteTrackRef {
  return {
    ownerUserId: track.ownerUserId,
    sessionId: track.sessionId,
    trackName: track.trackName,
    kind: track.kind,
  };
}

async function fetchTicket(officeSlug: string): Promise<Ticket> {
  const response = await fetch("/api/realtime-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeSlug }),
  });
  if (!response.ok) throw new Error("No se pudo obtener el acceso a medios.");
  return (await response.json()) as Ticket;
}

const EMPTY_BROADCAST_SPEAKER_IDS: ReadonlySet<string> = new Set();

const SUBSCRIBE_RETRY_MS = 4_000;
const SUBSCRIBE_NO_MIDS_RETRY_MS = 1_000;

function subscribeRetryDelay(error: unknown): number {
  if (error instanceof SubscribeResponseError && error.code === "NO_MIDS") {
    return SUBSCRIBE_NO_MIDS_RETRY_MS;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("no track mids")) return SUBSCRIBE_NO_MIDS_RETRY_MS;
  if (isMediaAuthorizationDenyError(error)) return 8_000;
  return SUBSCRIBE_RETRY_MS;
}

export function useOfficeMedia(options: {
  officeSlug: string;
  availableTracks: PublishedTrack[];
  nameFor: (userId: string) => string;
  localPosition: WorldPosition | null;
  remotePositions: Map<string, WorldPosition>;
  broadcastSpeakerIds?: ReadonlySet<string>;
  onEvictCatalogTrack?: (ref: RemoteTrackRef) => void;
}) {
  const {
    officeSlug,
    availableTracks,
    nameFor,
    localPosition,
    remotePositions,
    broadcastSpeakerIds = EMPTY_BROADCAST_SPEAKER_IDS,
    onEvictCatalogTrack,
  } = options;
  const onEvictCatalogTrackRef = useRef(onEvictCatalogTrack);
  onEvictCatalogTrackRef.current = onEvictCatalogTrack;
  const providerRef = useRef<CloudflareMediaProvider | null>(null);
  const proximityRef = useRef(new ProximityMediaController());
  const selfUserIdRef = useRef<string | null>(null);
  const selfAccessClassRef = useRef<SpatialAccessClass>("CLUB_MEMBER");
  const subscribedAudioUsersRef = useRef(new Set<string>());
  const subscribedVideoUsersRef = useRef(new Set<string>());
  const activeRemoteKeysRef = useRef(new Set<string>());
  const proximityFactorsRef = useRef(
    new Map<
      string,
      { audioFactor: number; videoFactor: number; zone: ProximityZone }
    >(),
  );
  const [micStatus, setMicStatus] = useState<DeviceStatus>("off");
  const [cameraStatus, setCameraStatus] = useState<DeviceStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<RemoteMedia[]>([]);
  const remotesRef = useRef(remotes);
  remotesRef.current = remotes;
  const [localPreview, setLocalPreview] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [accessClass, setAccessClass] =
    useState<SpatialAccessClass>("CLUB_MEMBER");
  const [proximityDebug, setProximityDebug] = useState<ProximityDebugRow[]>([]);
  const togglingRef = useRef(false);
  const subscribeRetryAfterRef = useRef(new Map<string, number>());
  const subscribeInFlightRef = useRef(new Set<string>());
  const catalogResyncRef = useRef(false);
  const mixerRef = useRef(new SpatialAudioMixer());
  const [audioFallbackKeys, setAudioFallbackKeys] = useState<string[]>([]);
  const [authorizedUserIds, setAuthorizedUserIds] = useState<string[]>([]);
  const [publishedKindsByUser, setPublishedKindsByUser] = useState(
    new Map<string, { audio: boolean; video: boolean }>(),
  );
  const mediaDiagnosticsRef = useRef(new MediaDiagnosticsCollector());
  const proximitySnapshotsRef = useRef<
    Array<{
      remoteUserId: string;
      distance: number;
      desiredAudioSubscription: boolean;
      desiredVideoSubscription: boolean;
      audioAuthorizationReason: string;
      videoAuthorizationReason: string;
    }>
  >([]);
  const [mediaDiagnostics, setMediaDiagnostics] =
    useState<MediaDiagnosticsSnapshot>({
      capturedAt: new Date().toISOString(),
      local: emptyLocalAudioDiagnostics(),
      remotes: [],
      recentEvents: [],
    });
  const [diagnosticAudioBypass, setDiagnosticAudioBypass] = useState(false);
  const diagnosticAudioBypassRef = useRef(diagnosticAudioBypass);
  diagnosticAudioBypassRef.current = diagnosticAudioBypass;
  const bootstrapMixerPlaybackRef = useRef<() => void>(() => undefined);
  const [lastMediaError, setLastMediaError] = useState<string | null>(null);
  const htmlAudioPlaybackRef = useRef(
    new Map<string, HtmlAudioPlaybackState>(),
  );

  const ticketSource = useCallback(async () => {
    const ticket = await fetchTicket(officeSlug);
    selfUserIdRef.current = ticket.userId;
    selfAccessClassRef.current = ticket.accessClass;
    setAccessClass(ticket.accessClass);
    return { ticket: ticket.ticket, mediaBaseUrl: ticket.mediaBaseUrl };
  }, [officeSlug]);

  useEffect(() => {
    let cancelled = false;
    let provider: CloudflareMediaProvider | null = null;

    void (async () => {
      try {
        const first = await fetchTicket(officeSlug);
        if (cancelled) return;
        selfUserIdRef.current = first.userId;
        selfAccessClassRef.current = first.accessClass;
        setAccessClass(first.accessClass);
        provider = new CloudflareMediaProvider(
          ticketSource,
          first.userId,
          {
            onRemoteTrack: (ref, track) => {
              mixerRef.current.ensurePlayback();
              const stream = new MediaStream([track]);
              const factors = proximityFactorsRef.current.get(ref.ownerUserId);
              const subscribed =
                ref.kind === "audio"
                  ? subscribedAudioUsersRef.current.has(ref.ownerUserId)
                  : subscribedVideoUsersRef.current.has(ref.ownerUserId);
              activeRemoteKeysRef.current.add(remoteKey(ref));
              setRemotes((current) => [
                ...current.filter((item) => item.key !== remoteKey(ref)),
                {
                  key: remoteKey(ref),
                  ref,
                  stream,
                  displayName: nameFor(ref.ownerUserId),
                  audioGain: effectiveAudioGain({
                    remoteMicPublished: true,
                    subscribed,
                    audioFactor: factors?.audioFactor ?? 0,
                  }),
                  videoOpacity: effectiveWorldVideoOpacity({
                    remoteCameraPublished: true,
                    subscribed,
                    videoFactor: factors?.videoFactor ?? 0,
                  }),
                  proximityZone: factors?.zone ?? "OUT_OF_RANGE",
                  subscribed,
                },
              ]);
            },
            onRemoteTrackClosed: (ref) => {
              activeRemoteKeysRef.current.delete(remoteKey(ref));
              setRemotes((current) =>
                current.filter((item) => item.key !== remoteKey(ref)),
              );
            },
            onState: (label) => {
              mediaDiagnosticsRef.current.peerState(label, label);
            },
          },
          mediaDiagnosticsRef.current,
        );
        await provider.connect();
        if (cancelled) {
          void provider.disconnect();
          return;
        }
        providerRef.current = provider;
        setReady(true);
      } catch (error) {
        mediaDiagnosticsRef.current.log(
          `connect:error ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!cancelled) setError("La sesión de medios no está disponible.");
      }
    })();

    return () => {
      cancelled = true;
      const active = providerRef.current ?? provider;
      providerRef.current = null;
      proximityRef.current.reset();
      mixerRef.current.dispose();
      mixerRef.current = new SpatialAudioMixer();
      void active?.disconnect();
    };
  }, [officeSlug, ticketSource, nameFor]);

  useEffect(() => {
    const provider = providerRef.current;
    const selfId = selfUserIdRef.current;
    if (!provider || !ready || !selfId || catalogResyncRef.current) return;

    const missingKinds = provider.publishedKinds().filter((kind) => {
      const publication = provider.getPublishedPublication(kind);
      if (!publication) return false;
      return !availableTracks.some(
        (track) =>
          track.ownerUserId === selfId &&
          track.kind === kind &&
          track.sessionId === publication.sessionId &&
          track.trackName === publication.trackName,
      );
    });

    if (missingKinds.length === 0) return;

    catalogResyncRef.current = true;
    void (async () => {
      try {
        for (const kind of missingKinds) {
          await provider.reregister(kind);
        }
      } catch (error) {
        mediaDiagnosticsRef.current.log(
          `catalog-resync:error ${error instanceof Error ? error.message : String(error)}`,
        );
        setLastMediaError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        catalogResyncRef.current = false;
      }
    })();
  }, [availableTracks, ready]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !ready || !localPosition) return;

    const snapshots = proximityRef.current.evaluate(
      localPosition,
      remotePositions,
      performance.now(),
      selfAccessClassRef.current,
      broadcastSpeakerIds,
    );
    proximitySnapshotsRef.current = snapshots.map((snapshot) => ({
      remoteUserId: snapshot.remoteUserId,
      distance: snapshot.distance,
      desiredAudioSubscription: snapshot.desiredAudioSubscription,
      desiredVideoSubscription: snapshot.desiredVideoSubscription,
      audioAuthorizationReason: snapshot.audioAuthorizationReason,
      videoAuthorizationReason: snapshot.videoAuthorizationReason,
    }));
    const snapshotByUser = new Map(
      snapshots.map((snapshot) => [snapshot.remoteUserId, snapshot]),
    );
    proximityFactorsRef.current = new Map(
      snapshots.map((snapshot) => [
        snapshot.remoteUserId,
        {
          audioFactor: snapshot.audioFactor,
          videoFactor: snapshot.videoFactor,
          zone: snapshot.zone,
        },
      ]),
    );

    const tracksByUser = new Map<string, PublishedTrack[]>();
    for (const track of availableTracks) {
      if (track.ownerUserId === selfUserIdRef.current) continue;
      const bucket = tracksByUser.get(track.ownerUserId) ?? [];
      bucket.push(track);
      tracksByUser.set(track.ownerUserId, bucket);
    }

    const boundRefs: RemoteTrackRef[] = [];
    for (const key of activeRemoteKeysRef.current) {
      const remote = remotesRef.current.find((item) => item.key === key);
      if (remote) boundRefs.push(remote.ref);
    }
    for (const staleRef of findStaleRemoteRefs(boundRefs, availableTracks)) {
      if (provider.isRemoteBound(staleRef)) {
        void provider.unsubscribe(staleRef).catch((error) => {
          mediaDiagnosticsRef.current.log(
            `stale-unsubscribe:error ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }

    const desiredAudioUsers = new Set<string>();
    const desiredVideoUsers = new Set<string>();
    const refsToSubscribe: RemoteTrackRef[] = [];

    for (const userId of tracksByUser.keys()) {
      const snapshot = snapshotByUser.get(userId);
      const shouldSubscribeAudio = snapshot?.desiredAudioSubscription ?? false;
      const shouldSubscribeVideo = snapshot?.desiredVideoSubscription ?? false;
      if (shouldSubscribeAudio) desiredAudioUsers.add(userId);
      if (shouldSubscribeVideo) desiredVideoUsers.add(userId);
    }

    subscribedAudioUsersRef.current = desiredAudioUsers;
    subscribedVideoUsersRef.current = desiredVideoUsers;

    for (const [userId, tracks] of tracksByUser) {
      const snapshot = snapshotByUser.get(userId);
      const shouldSubscribeAudio = snapshot?.desiredAudioSubscription ?? false;
      const shouldSubscribeVideo = snapshot?.desiredVideoSubscription ?? false;
      for (const track of tracks) {
        const ref = trackRef(track);
        const shouldSubscribe =
          track.kind === "audio" ? shouldSubscribeAudio : shouldSubscribeVideo;
        if (shouldSubscribe) {
          if (!provider.isRemoteBound(ref)) {
            const retryKey = remoteKey(ref);
            if (subscribeInFlightRef.current.has(retryKey)) continue;
            const retryAfter =
              subscribeRetryAfterRef.current.get(retryKey) ?? 0;
            if (Date.now() < retryAfter) continue;
            refsToSubscribe.push(ref);
          }
        } else if (track.kind === "video" && provider.isRemoteBound(ref)) {
          void provider.unsubscribe(ref).catch((error) => {
            mediaDiagnosticsRef.current.log(
              `unsubscribe:error ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
      }
    }

    if (refsToSubscribe.length > 0) {
      const { audio, video } = partitionSubscribeRefs(refsToSubscribe);
      const startSubscribe = (group: RemoteTrackRef[]) => {
        if (group.length === 0) return;
        for (const ref of group) {
          const retryKey = remoteKey(ref);
          subscribeInFlightRef.current.add(retryKey);
          subscribeRetryAfterRef.current.set(
            retryKey,
            Date.now() + SUBSCRIBE_RETRY_MS,
          );
        }
        void provider
          .subscribeMany(group)
          .then(() => {
            for (const ref of group) {
              subscribeRetryAfterRef.current.delete(remoteKey(ref));
            }
          })
          .catch((error) => {
            for (const ref of group) {
              mediaDiagnosticsRef.current.subscribeFailure(ref, error);
            }
            setLastMediaError(
              error instanceof Error ? error.message : String(error),
            );
            for (const ref of group) {
              const retryKey = remoteKey(ref);
              if (
                isCatalogRegistrationError(error) ||
                isStaleSfuPublicationError(error)
              ) {
                onEvictCatalogTrackRef.current?.(ref);
                subscribeRetryAfterRef.current.delete(retryKey);
                continue;
              }
              subscribeRetryAfterRef.current.set(
                retryKey,
                Date.now() + subscribeRetryDelay(error),
              );
            }
          })
          .finally(() => {
            for (const ref of group) {
              subscribeInFlightRef.current.delete(remoteKey(ref));
            }
          });
      };
      startSubscribe(audio);
      startSubscribe(video);
    }

    const publishedKindsByUser = new Map<
      string,
      { audio: boolean; video: boolean }
    >();
    for (const track of availableTracks) {
      const current = publishedKindsByUser.get(track.ownerUserId) ?? {
        audio: false,
        video: false,
      };
      if (track.kind === "audio") current.audio = true;
      if (track.kind === "video") current.video = true;
      publishedKindsByUser.set(track.ownerUserId, current);
    }
    setPublishedKindsByUser(publishedKindsByUser);
    setAuthorizedUserIds(
      snapshots
        .filter((snapshot) => snapshot.desiredSubscription)
        .map((snapshot) => snapshot.remoteUserId),
    );

    setRemotes((current) => {
      let changed = false;
      const next = current.map((item) => {
        const factors = proximityFactorsRef.current.get(item.ref.ownerUserId);
        const subscribed =
          item.ref.kind === "audio"
            ? desiredAudioUsers.has(item.ref.ownerUserId)
            : desiredVideoUsers.has(item.ref.ownerUserId);
        const published = publishedKindsByUser.get(item.ref.ownerUserId);
        const audioGain = effectiveAudioGain({
          remoteMicPublished: Boolean(published?.audio),
          subscribed,
          audioFactor: factors?.audioFactor ?? 0,
        });
        const videoOpacity = effectiveWorldVideoOpacity({
          remoteCameraPublished: Boolean(published?.video),
          subscribed,
          videoFactor: factors?.videoFactor ?? 0,
        });
        const proximityZone = factors?.zone ?? "OUT_OF_RANGE";
        if (
          item.audioGain === audioGain &&
          item.videoOpacity === videoOpacity &&
          item.proximityZone === proximityZone &&
          item.subscribed === subscribed
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          audioGain,
          videoOpacity,
          proximityZone,
          subscribed,
        };
      });
      return changed ? next : current;
    });

    const debugRows: ProximityDebugRow[] = snapshots.map((snapshot) => {
      const published = publishedKindsByUser.get(snapshot.remoteUserId);
      const userTracks = tracksByUser.get(snapshot.remoteUserId) ?? [];
      const audioTrackKey = userTracks.find((track) => track.kind === "audio");
      const videoTrackKey = userTracks.find((track) => track.kind === "video");
      return {
        localParticipantId: selfUserIdRef.current,
        remoteParticipantId: snapshot.remoteUserId,
        distance: snapshot.distance,
        audioFactor: snapshot.audioFactor,
        videoFactor: snapshot.videoFactor,
        proximityZone: snapshot.zone,
        desiredSubscription:
          snapshot.desiredAudioSubscription ||
          snapshot.desiredVideoSubscription,
        actualAudioSubscribed:
          snapshot.desiredAudioSubscription &&
          Boolean(published?.audio) &&
          Boolean(
            audioTrackKey &&
            activeRemoteKeysRef.current.has(
              remoteKey({
                sessionId: audioTrackKey.sessionId,
                trackName: audioTrackKey.trackName,
              }),
            ),
          ),
        actualVideoSubscribed:
          snapshot.desiredVideoSubscription &&
          Boolean(published?.video) &&
          Boolean(
            videoTrackKey &&
            activeRemoteKeysRef.current.has(
              remoteKey({
                sessionId: videoTrackKey.sessionId,
                trackName: videoTrackKey.trackName,
              }),
            ),
          ),
      };
    });
    setProximityDebug(debugRows);
  }, [
    availableTracks,
    ready,
    localPosition,
    remotePositions,
    broadcastSpeakerIds,
  ]);

  useEffect(() => {
    const result = syncSpatialAudioGraph(mixerRef.current, remotes, {
      forceHtmlPlayback: diagnosticAudioBypass,
    });
    mixerRef.current.ensurePlayback();
    setAudioFallbackKeys(result.fallbackKeys);
  }, [remotes, diagnosticAudioBypass]);

  const bootstrapMixerPlayback = useCallback(() => {
    const useHtml = diagnosticAudioBypassRef.current;
    mixerRef.current.unlock();
    const result = syncSpatialAudioGraph(mixerRef.current, remotesRef.current, {
      forceHtmlPlayback: useHtml,
    });
    mixerRef.current.ensurePlayback();
    setAudioFallbackKeys(result.fallbackKeys);
  }, []);
  bootstrapMixerPlaybackRef.current = bootstrapMixerPlayback;

  useEffect(() => {
    if (micStatus !== "on" && cameraStatus !== "on") return;
    const timer = window.setInterval(() => {
      const provider = providerRef.current as {
        repairSendTransportIfNeeded?: () => Promise<void>;
      } | null;
      void provider?.repairSendTransportIfNeeded?.();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [micStatus, cameraStatus]);

  const refreshMediaDiagnostics = useCallback(() => {
    const provider = providerRef.current;
    const publishedAudio = provider?.getPublishedLocal("audio");
    const fallbackSet = new Set(audioFallbackKeys);
    const attached = mixerRef.current.attachedKeys();

    const remoteRows = proximitySnapshotsRef.current.map((snapshot) => {
      const audioTrack = availableTracks.find(
        (track) =>
          track.ownerUserId === snapshot.remoteUserId && track.kind === "audio",
      );
      const audioRemote = remotesRef.current.find(
        (media) =>
          media.ref.kind === "audio" &&
          media.ref.ownerUserId === snapshot.remoteUserId,
      );
      const participant = remotesRef.current.find(
        (media) => media.ref.ownerUserId === snapshot.remoteUserId,
      );
      return {
        userId: snapshot.remoteUserId,
        displayName:
          participant?.displayName ?? snapshot.remoteUserId.slice(0, 8),
        distanceTiles: snapshot.distance / TILE_SIZE,
        proximityAudioAuthorized: snapshot.desiredAudioSubscription,
        proximityVideoAuthorized: snapshot.desiredVideoSubscription,
        audioPublication: audioTrack
          ? {
              sessionId: audioTrack.sessionId,
              trackName: audioTrack.trackName,
            }
          : null,
        subscriptionRequested: snapshot.desiredAudioSubscription,
        sessionId: audioTrack?.sessionId ?? null,
        trackName: audioTrack?.trackName ?? null,
        track: audioTrack
          ? (provider?.getRemoteTrack({
              ownerUserId: snapshot.remoteUserId,
              sessionId: audioTrack.sessionId,
              trackName: audioTrack.trackName,
              kind: "audio",
            }) ?? null)
          : null,
        mixerAttached: audioRemote ? attached.includes(audioRemote.key) : false,
        currentGain: audioRemote?.audioGain ?? null,
        fallbackActive: audioRemote ? fallbackSet.has(audioRemote.key) : false,
        htmlAudioState:
          htmlAudioPlaybackRef.current.get(audioRemote?.key ?? "")?.state ??
          "inactive",
        lastPlayError:
          htmlAudioPlaybackRef.current.get(audioRemote?.key ?? "")?.error ??
          null,
        localZoneId: localPosition?.zoneId ?? null,
        remoteZoneId:
          remotePositions.get(snapshot.remoteUserId)?.zoneId ?? null,
        audioAuthorizationReason: snapshot.audioAuthorizationReason,
        videoAuthorizationReason: snapshot.videoAuthorizationReason,
      };
    });

    setMediaDiagnostics(
      mediaDiagnosticsRef.current.snapshot({
        micUiState: micStatus,
        localAudioTrack: publishedAudio?.track ?? null,
        sendPeer: provider?.getSendPeerConnection() ?? null,
        recvPeer: provider?.getRecvPeerConnection() ?? null,
        audioSender: publishedAudio?.transceiver.sender ?? null,
        audioTransceiver: publishedAudio?.transceiver ?? null,
        publishedAudio: provider?.getPublishedPublication("audio") ?? null,
        publishedVideo: provider?.getPublishedPublication("video") ?? null,
        lastMediaError,
        localZoneId: localPosition?.zoneId ?? null,
        selfAccessClass: selfAccessClassRef.current,
        audioContextState: mixerRef.current.audioContextState(),
        audioOutputUnlocked: mixerRef.current.isGestureUnlocked(),
        mixerAttachedKeys: attached,
        audioFallbackKeys,
        remotes: remoteRows,
      }),
    );
  }, [
    availableTracks,
    micStatus,
    audioFallbackKeys,
    lastMediaError,
    localPosition,
    remotePositions,
  ]);

  useEffect(() => {
    if (!spatialDebugEnabled()) return;
    refreshMediaDiagnostics();
    const timer = window.setInterval(refreshMediaDiagnostics, 1_000);
    return () => window.clearInterval(timer);
  }, [refreshMediaDiagnostics, remotes, ready]);

  const onHtmlAudioPlaybackState = useCallback(
    (state: HtmlAudioPlaybackState) => {
      htmlAudioPlaybackRef.current.set(state.key, state);
      if (state.error) {
        mediaDiagnosticsRef.current.playbackState(
          state.key,
          state.state === "blocked" ? "blocked" : "paused",
          state.error,
        );
      }
      if (spatialDebugEnabled()) refreshMediaDiagnostics();
    },
    [refreshMediaDiagnostics],
  );

  const unlockSpatialAudio = useCallback(() => {
    bootstrapMixerPlayback();
    window.dispatchEvent(new Event(SPATIAL_AUDIO_UNLOCK_EVENT));
  }, [bootstrapMixerPlayback]);

  const toggle = useCallback(async (kind: MediaKind, deviceId?: string) => {
    const provider = providerRef.current;
    if (!provider || togglingRef.current) return;
    togglingRef.current = true;
    bootstrapMixerPlaybackRef.current();
    const setStatus = kind === "audio" ? setMicStatus : setCameraStatus;
    const isOn = provider.publishedKinds().includes(kind);
    setError(null);

    try {
      if (isOn) {
        setStatus("off");
        if (kind === "video") setLocalPreview(null);
        await provider.unpublish(kind).catch((error) => {
          mediaDiagnosticsRef.current.log(
            `unpublish:error ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        return;
      }

      setStatus("starting");
      let track: MediaStreamTrack | null = null;
      try {
        track = await captureLocalTrack(kind, deviceId);
        if (kind === "video") setLocalPreview(new MediaStream([track]));
        setStatus("on");
        await provider.publish(kind, track);
      } catch (cause) {
        if (track && track.readyState === "live") track.stop();
        if (kind === "video") setLocalPreview(null);
        setStatus("failed");
        setError(classifyMediaDeviceError(cause));
        setTimeout(() => setStatus("off"), 2_500);
      }
    } finally {
      togglingRef.current = false;
    }
  }, []);

  return useMemo(
    () => ({
      ready,
      micStatus,
      cameraStatus,
      error,
      remotes,
      localPreview,
      proximityDebug,
      audioFallbackKeys,
      authorizedUserIds,
      publishedKindsByUser,
      mediaDiagnostics,
      lastMediaError,
      diagnosticAudioBypass,
      setDiagnosticAudioBypass,
      onHtmlAudioPlaybackState,
      refreshMediaDiagnostics,
      unlockSpatialAudio,
      accessClass,
      toggleMic: (deviceId?: string) => toggle("audio", deviceId),
      toggleCamera: (deviceId?: string) => toggle("video", deviceId),
    }),
    [
      ready,
      micStatus,
      cameraStatus,
      error,
      remotes,
      localPreview,
      proximityDebug,
      audioFallbackKeys,
      authorizedUserIds,
      publishedKindsByUser,
      mediaDiagnostics,
      lastMediaError,
      diagnosticAudioBypass,
      onHtmlAudioPlaybackState,
      refreshMediaDiagnostics,
      unlockSpatialAudio,
      accessClass,
      toggle,
    ],
  );
}
