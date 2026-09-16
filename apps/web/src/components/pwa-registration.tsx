"use client";

import { useEffect, useState } from "react";

export function PwaRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(
    null,
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let active = true;
    let cleanupRegistration = () => {};
    let wasControlled = Boolean(navigator.serviceWorker.controller);
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (!active) return;
        if (registration.waiting) setWaitingWorker(registration.waiting);
        const installingCleanups: Array<() => void> = [];
        const updateFound = () => {
          const installing = registration.installing;
          if (!installing) return;
          const stateChanged = () => {
            if (
              active &&
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(installing);
            }
          };
          installing.addEventListener("statechange", stateChanged);
          installingCleanups.push(() =>
            installing.removeEventListener("statechange", stateChanged),
          );
        };
        registration.addEventListener("updatefound", updateFound);
        cleanupRegistration = () => {
          registration.removeEventListener("updatefound", updateFound);
          installingCleanups.forEach((cleanup) => cleanup());
        };
      })
      .catch(() => {
        // Offline/private browsing can refuse registration; the app still works.
      });

    const reload = () => {
      // First installation must not reload an active login or media session.
      if (wasControlled) window.location.reload();
      wasControlled = true;
    };
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => {
      active = false;
      cleanupRegistration();
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
