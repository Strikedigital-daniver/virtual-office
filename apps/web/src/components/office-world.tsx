"use client";

import type { PublishedTrack } from "@virtual-office/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { MediaControls } from "@/components/media-controls";
import { MediaTiles } from "@/components/media-tiles";
import { useOfficeMedia } from "@/lib/media/use-office-media";

interface OfficeWorldProps {
  officeSlug: string;
}

export function OfficeWorld({ officeSlug }: OfficeWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Cargando mundo…");
  const [tracks, setTracks] = useState<PublishedTrack[]>([]);
  const namesRef = useRef(new Map<string, string>());

  const nameFor = useCallback(
    (userId: string) => namesRef.current.get(userId) ?? "Integrante",
    [],
  );

  const media = useOfficeMedia({
    officeSlug,
    availableTracks: tracks,
    nameFor,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let handle: { destroy: () => void } | null = null;

    void import("@/lib/game/office-game").then(async ({ createOfficeGame }) => {
      if (cancelled) return;
      handle = await createOfficeGame({
        container,
        officeSlug,
        onStatus: (value) => {
          if (!cancelled) setStatus(value);
        },
        onTracks: (value) => {
          if (!cancelled) setTracks(value);
        },
        onPlayers: (players) => {
          for (const player of players) {
            namesRef.current.set(player.userId, player.displayName);
          }
        },
      });
      if (cancelled) handle.destroy();
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [officeSlug]);

  const connected = status === "Conectado";

  return (
    <div className="office-world">
      <div ref={containerRef} className="office-world-canvas" />
      <p className="office-world-status" role="status">
        <span
          className={connected ? "status-dot" : "status-dot pending"}
          aria-hidden="true"
        />
        {status}
        <span className="office-world-hint">WASD o flechas para caminar</span>
      </p>
      <MediaTiles remotes={media.remotes} localPreview={media.localPreview} />
      <MediaControls
        ready={media.ready}
        micStatus={media.micStatus}
        cameraStatus={media.cameraStatus}
        error={media.error}
        onToggleMic={media.toggleMic}
        onToggleCamera={media.toggleCamera}
      />
    </div>
  );
}
