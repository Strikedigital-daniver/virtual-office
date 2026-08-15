"use client";

import { useEffect, useState } from "react";

export function PwaRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let active = true;
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (!active) return;
      if (registration.waiting) setWaitingWorker(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            setWaitingWorker(installing);
          }
        });
      });
    });

    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", reload);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <aside className="update-banner" aria-live="polite">
      <span>Hay una actualización segura disponible.</span>
      <button
        type="button"
        onClick={() => waitingWorker.postMessage("SKIP_WAITING")}
      >
        Actualizar
      </button>
    </aside>
  );
}
