"use client";

import { useEffect, useState } from "react";

import type { DeviceStatus } from "@/lib/media/use-office-media";

interface MediaControlsProps {
  ready: boolean;
  micStatus: DeviceStatus;
  cameraStatus: DeviceStatus;
  error: string | null;
  onToggleMic: (deviceId?: string) => void;
  onToggleCamera: (deviceId?: string) => void;
}

const LABELS: Record<DeviceStatus, string> = {
  off: "Apagado",
  starting: "Activando…",
  on: "Encendido",
  failed: "Error",
};

export function MediaControls({
  ready,
  micStatus,
  cameraStatus,
  error,
  onToggleMic,
  onToggleCamera,
}: MediaControlsProps) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [showDevices, setShowDevices] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          setMics(devices.filter((device) => device.kind === "audioinput"));
          setCameras(devices.filter((device) => device.kind === "videoinput"));
        })
        .catch(() => undefined);
    };
    load();
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener("devicechange", load);
    };
  }, [micStatus, cameraStatus]);

  return (
    <div className="media-controls">
      <button
        type="button"
        className={micStatus === "on" ? "media-toggle active" : "media-toggle"}
        disabled={!ready || micStatus === "starting"}
        aria-pressed={micStatus === "on"}
        onClick={() => onToggleMic(micId || undefined)}
      >
        <span aria-hidden="true">{micStatus === "on" ? "🎤" : "🔇"}</span>
        Micrófono
        <small>{LABELS[micStatus]}</small>
      </button>
      <button
        type="button"
        className={
          cameraStatus === "on" ? "media-toggle active" : "media-toggle"
        }
        disabled={!ready || cameraStatus === "starting"}
        aria-pressed={cameraStatus === "on"}
        onClick={() => onToggleCamera(cameraId || undefined)}
      >
        <span aria-hidden="true">{cameraStatus === "on" ? "🎥" : "📵"}</span>
        Cámara
        <small>{LABELS[cameraStatus]}</small>
      </button>
      <button
        type="button"
        className="media-toggle subtle"
        onClick={() => setShowDevices((value) => !value)}
        aria-expanded={showDevices}
      >
        <span aria-hidden="true">⚙️</span>
        Dispositivos
      </button>

      {showDevices ? (
        <div className="media-devices">
          <label htmlFor="mic-device">Micrófono</label>
          <select
            id="mic-device"
            value={micId}
            onChange={(event) => setMicId(event.target.value)}
          >
            <option value="">Predeterminado</option>
            {mics.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Micrófono ${index + 1}`}
              </option>
            ))}
          </select>
          <label htmlFor="camera-device">Cámara</label>
          <select
            id="camera-device"
            value={cameraId}
            onChange={(event) => setCameraId(event.target.value)}
          >
            <option value="">Predeterminada</option>
            {cameras.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Cámara ${index + 1}`}
              </option>
            ))}
          </select>
          <p className="media-hint">
            Los nombres aparecen después de conceder permiso una vez.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="error media-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
