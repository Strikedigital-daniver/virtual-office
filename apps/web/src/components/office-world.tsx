"use client";

import { useEffect, useRef, useState } from "react";

interface OfficeWorldProps {
  officeSlug: string;
}

export function OfficeWorld({ officeSlug }: OfficeWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Cargando mundo…");

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
    </div>
  );
}
