"use client";

import type { OfficeWorldProps } from "./office-world-props";
import { AvatarCustomizer } from "@/components/avatar-customizer";
import { MediaControls } from "@/components/media-controls";
import { MediaTiles } from "@/components/media-tiles";
import { ProximityAudioPlayback } from "@/components/proximity-audio-playback";
import { audibleHtmlAudioKeys } from "@/lib/proximity/spatial-audio-mixer";
import {
  ProximityMediaDebugPanel,
  proximityDebugEnabled,
} from "@/components/proximity-media-debug";
import {
  SpatialChatPanel,
  type SpatialChatLiveMessage,
} from "@/components/spatial-chat-panel";
import { SpatialDebugPanel } from "@/components/spatial-debug-panel";
import { useOfficeMedia } from "@/lib/media/use-office-media";
import type { ChatDiagnosticsSnapshot } from "@/lib/spatial-debug/chat-diagnostics";
import { spatialDebugEnabled } from "@/lib/spatial-debug/enabled";
import type { WorldPosition } from "@/lib/proximity/proximity-media-controller";
import type { OfficeGameHandle } from "@/lib/game/office-game";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_AVATAR_APPEARANCE,
  type AvatarAppearance,
  type PublishedTrack,
} from "@virtual-office/shared";
import { canModerateManualSpeaker } from "@virtual-office/shared";
import { resolveAvatarLoadPriority } from "@/lib/avatar/persistence";
import {
  readLocalAvatarFallback,
  writeLocalAvatarFallback,
} from "@/lib/avatar/repository";

interface RoomParticipant {
  userId: string;
  displayName: string;
  broadcastSpeakerSource?: "zone" | "manual" | null;
  inBroadcastZone?: boolean;
  broadcastCapacityBlocked?: boolean;
  appearance?: AvatarAppearance;
}

export function OfficeWorld({ officeSlug }: OfficeWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<OfficeGameHandle | null>(null);
  const [status, setStatus] = useState("Cargando mundo…");
  const [presenceConnected, setPresenceConnected] = useState(false);
  const [deskState, setDeskState] = useState<{
    currentDeskId: string | null;
    nearestDeskId: string | null;
  }>({ currentDeskId: null, nearestDeskId: null });
  const [tracks, setTracks] = useState<PublishedTrack[]>([]);
  const [liveChatMessages, setLiveChatMessages] = useState<
    SpatialChatLiveMessage[]
  >([]);
  const [chatDiagnostics, setChatDiagnostics] =
    useState<ChatDiagnosticsSnapshot>({
      capturedAt: new Date().toISOString(),
      selectedChannelId: null,
      panelOpen: false,
      initialLoad: "idle",
      sending: false,
      restAuthenticated: false,
      websocket: "disconnected",
      listenerCount: 0,
      receivedEventCount: 0,
      renderedMessageCount: 0,
      queuedLiveMessages: 0,
      liveBufferSize: 0,
      lastRestStatus: null,
      lastRestError: null,
      lastFanoutWarning: null,
      lastRealtimeEventAt: null,
      channelsLoading: false,
      loadGeneration: 0,
      inputFocused: false,
      keyboardGuardActive: false,
      recentTransitions: [],
    });
  const [positionState, setPositionState] = useState<{
    selfId: string | null;
    positions: Map<string, WorldPosition>;
  }>({ selfId: null, positions: new Map() });
  const [broadcastState, setBroadcastState] = useState({
    inBroadcastZone: false,
    broadcastCapacityBlocked: false,
    broadcastSpeakerSource: null as "zone" | "manual" | null,
  });
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [selfAppearance, setSelfAppearance] = useState<AvatarAppearance>(
    DEFAULT_AVATAR_APPEARANCE,
  );
  const namesRef = useRef(new Map<string, string>());

  const nameFor = useCallback(
    (userId: string) => namesRef.current.get(userId) ?? "Integrante",
    [],
  );

  const localPosition = useMemo(() => {
    if (!positionState.selfId) return null;
    return positionState.positions.get(positionState.selfId) ?? null;
  }, [positionState]);

  const remotePositions = useMemo(() => {
    const map = new Map(positionState.positions);
    if (positionState.selfId) map.delete(positionState.selfId);
    return map;
  }, [positionState]);

  const broadcastSpeakerIds = useMemo(() => {
    const ids = new Set<string>();
    if (broadcastState.broadcastSpeakerSource) {
      const selfId = positionState.selfId;
      if (selfId) ids.add(selfId);
    }
    for (const participant of participants) {
      if (participant.broadcastSpeakerSource) {
        ids.add(participant.userId);
      }
    }
    return ids;
  }, [
    broadcastState.broadcastSpeakerSource,
    participants,
    positionState.selfId,
  ]);

  const media = useOfficeMedia({
    officeSlug,
    presenceConnected,
    availableTracks: tracks,
    nameFor,
    localPosition,
    remotePositions,
    broadcastSpeakerIds,
    onEvictCatalogTrack: (ref) => {
      gameRef.current?.evictPublishedTrack(ref);
    },
  });

  const remoteAppearances = useMemo(() => {
    const map = new Map<string, AvatarAppearance>();
    for (const participant of participants) {
      if (participant.appearance) {
        map.set(participant.userId, participant.appearance);
      }
    }
    return map;
  }, [participants]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let handle: OfficeGameHandle | null = null;

    void import("@/lib/game/office-game").then(async ({ createOfficeGame }) => {
      const localAppearance = readLocalAvatarFallback();
      let serverAvailable = false;
      let hasLoadout = false;
      let serverAppearance: AvatarAppearance | undefined;
      try {
        const response = await fetch("/api/spatial-avatar", {
          credentials: "same-origin",
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            appearance?: AvatarAppearance;
            hasLoadout?: boolean;
          };
          serverAvailable = true;
          hasLoadout = Boolean(payload.hasLoadout);
          serverAppearance = payload.appearance;
        }
      } catch {
        serverAvailable = false;
      }
      const loaded = resolveAvatarLoadPriority({
        serverAvailable,
        hasLoadout,
        serverAppearance,
        localAppearance,
      });
      const appearance = loaded.appearance;
      if (cancelled) return;
      if (loaded.source === "server") {
        writeLocalAvatarFallback(appearance);
      }
      setSelfAppearance(appearance);
      handle = await createOfficeGame({
        container,
        officeSlug,
        initialAppearance: appearance,
        onStatus: (value) => {
          if (!cancelled) setStatus(value);
        },
        onPresenceConnected: (connected) => {
          if (!cancelled) setPresenceConnected(connected);
        },
        onTracks: (value) => {
          if (!cancelled) setTracks(value);
        },
        onPlayers: (players) => {
          if (!cancelled) setParticipants(players);
          for (const player of players) {
            namesRef.current.set(player.userId, player.displayName);
          }
        },
        onBroadcastState: (state) => {
          if (!cancelled) setBroadcastState(state);
        },
        onPositions: (positions, selfUserId) => {
          if (cancelled) return;
          setPositionState({
            selfId: selfUserId,
            positions: new Map(positions),
          });
        },
        onSpatialChatMessage: (message) => {
          if (cancelled) return;
          setLiveChatMessages((current) => {
            const next = [
              ...current,
              {
                messageId: message.messageId,
                channelId: message.channelId,
                authorUserId: message.authorUserId,
                displayName: message.displayName,
                body: message.body,
                createdAt: message.createdAt,
                clientMessageId: null,
                clientKey: message.messageId,
              },
            ];
            return next.length > 200 ? next.slice(-200) : next;
          });
        },
        onDeskState: (state) => {
          if (!cancelled) setDeskState(state);
        },
      });
      if (cancelled) handle.destroy();
      else gameRef.current = handle;
    });

    return () => {
      cancelled = true;
      gameRef.current = null;
      handle?.destroy();
    };
  }, [officeSlug]);

  const useDesk = useCallback(() => {
    gameRef.current?.useNearestDesk();
  }, []);

  const setSpeaker = useCallback((targetUserId: string) => {
    gameRef.current?.setBroadcastSpeaker(targetUserId);
  }, []);

  const removeSpeaker = useCallback((targetUserId: string) => {
    gameRef.current?.removeBroadcastSpeaker(targetUserId);
  }, []);

  const openDirect = useCallback(async (targetUserId: string) => {
    const response = await fetch("/api/spatial-chat/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      channel: { channelId: string };
    };
    window.dispatchEvent(
      new CustomEvent("spatial-chat-select-channel", {
        detail: { channelId: payload.channel.channelId },
      }),
    );
  }, []);

  const zoomIn = useCallback(() => {
    gameRef.current?.zoomBy(-120);
  }, []);

  const zoomOut = useCallback(() => {
    gameRef.current?.zoomBy(120);
  }, []);

  const broadcastSpeakerSourceFor = useCallback(
    (userId: string) => {
      if (userId === positionState.selfId) {
        return broadcastState.broadcastSpeakerSource;
      }
      return (
        participants.find((participant) => participant.userId === userId)
          ?.broadcastSpeakerSource ?? null
      );
    },
    [broadcastState.broadcastSpeakerSource, participants, positionState.selfId],
  );

  const connected = status === "Conectado";
  const websocketStatus =
    status === "Conectado"
      ? "connected"
      : status === "Reconectando…" || status === "Conectando…"
        ? "reconnecting"
        : "disconnected";
  const showSpatialDebug = spatialDebugEnabled();
  const canModerate = canModerateManualSpeaker(media.accessClass);

  const canUseDesk =
    connected && !deskState.currentDeskId && Boolean(deskState.nearestDeskId);

  useEffect(() => {
    const unlock = () => media.unlockSpatialAudio();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [media.unlockSpatialAudio]);

  return (
    <div className="office-world">
      <div className="office-world-stage">
        <div ref={containerRef} className="office-world-canvas" />
        <div className="office-world-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={zoomIn} aria-label="Acercar">
            +
          </button>
          <button type="button" onClick={zoomOut} aria-label="Alejar">
            −
          </button>
        </div>
        <p className="office-world-status" role="status">
          <span
            className={connected ? "status-dot" : "status-dot pending"}
            aria-hidden="true"
          />
          {status}
          <span className="office-world-hint">
            WASD · rueda o +/- · doble clic para ir
          </span>
          {deskState.currentDeskId ? (
            <span className="office-world-desk-status">En escritorio</span>
          ) : null}
          {broadcastState.inBroadcastZone ? (
            <span className="office-world-broadcast-status">
              🔥 Estás en la fogata
            </span>
          ) : null}
          {broadcastState.broadcastCapacityBlocked ? (
            <span className="office-world-broadcast-capacity">
              El círculo de voz está completo
            </span>
          ) : null}
          {broadcastState.broadcastSpeakerSource === "manual" ? (
            <span className="office-world-speaker-status">📡 Speaker</span>
          ) : null}
          {broadcastState.inBroadcastZone &&
          !broadcastState.broadcastSpeakerSource &&
          !broadcastState.broadcastCapacityBlocked ? (
            <span className="office-world-broadcast-hint">
              Activa tu micrófono para hablar a todos
            </span>
          ) : null}
        </p>
        <button
          type="button"
          className="office-world-avatar-action"
          onClick={() => setCustomizerOpen(true)}
        >
          Personalizar personaje
        </button>
        {canUseDesk ? (
          <button
            type="button"
            className="office-world-desk-action"
            onClick={useDesk}
          >
            Usar escritorio
          </button>
        ) : null}
        <MediaTiles
          remotes={media.remotes}
          localPreview={media.localPreview}
          selfAppearance={selfAppearance}
          selfMicOn={media.micStatus === "on"}
          appearances={remoteAppearances}
          authorizedUserIds={media.authorizedUserIds}
          displayNameFor={nameFor}
          publishedKindsByUser={media.publishedKindsByUser}
          canModerate={canModerate}
          broadcastSpeakerSourceFor={broadcastSpeakerSourceFor}
          onSetSpeaker={setSpeaker}
          onRemoveSpeaker={removeSpeaker}
        />
        <ProximityAudioPlayback
          remotes={media.remotes}
          audibleKeys={audibleHtmlAudioKeys(
            media.remotes,
            media.audioFallbackKeys,
            media.diagnosticAudioBypass,
          )}
          onPlaybackState={media.onHtmlAudioPlaybackState}
        />
        <MediaControls
          ready={media.ready}
          micStatus={media.micStatus}
          cameraStatus={media.cameraStatus}
          error={media.error}
          onToggleMic={media.toggleMic}
          onToggleCamera={media.toggleCamera}
        />
        {proximityDebugEnabled() ? (
          <ProximityMediaDebugPanel rows={media.proximityDebug} />
        ) : null}
        {showSpatialDebug ? (
          <SpatialDebugPanel
            media={media.mediaDiagnostics}
            chat={chatDiagnostics}
            websocketStatus={status}
            diagnosticAudioBypass={media.diagnosticAudioBypass}
            onToggleDiagnosticAudioBypass={() =>
              media.setDiagnosticAudioBypass((value) => !value)
            }
          />
        ) : null}
      </div>
      <SpatialChatPanel
        chatReady={Boolean(positionState.selfId)}
        accessClass={media.accessClass}
        selfUserId={positionState.selfId}
        participants={participants}
        appearances={remoteAppearances}
        selfAppearance={selfAppearance}
        liveMessages={liveChatMessages}
        websocketStatus={websocketStatus}
        onDiagnosticsChange={setChatDiagnostics}
        onOpenDirect={openDirect}
      />
      <AvatarCustomizer
        open={customizerOpen}
        current={selfAppearance}
        onClose={() => setCustomizerOpen(false)}
        onSaved={(appearance) => {
          setSelfAppearance(appearance);
          writeLocalAvatarFallback(appearance);
          gameRef.current?.applyAppearance(appearance);
        }}
      />
    </div>
  );
}
