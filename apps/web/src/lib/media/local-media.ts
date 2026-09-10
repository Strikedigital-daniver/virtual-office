import {
  audioConstraints,
  videoConstraints,
  type MediaKind,
} from "@virtual-office/shared";

import {
  createSyntheticTrack,
  syntheticProfileForDevice,
} from "./synthetic-media";

export function mediaConstraintsFor(
  kind: MediaKind,
  deviceId?: string,
  relaxed = false,
): MediaStreamConstraints {
  if (kind === "audio") {
    const audio: MediaTrackConstraints = relaxed ? {} : { ...audioConstraints };
    if (deviceId) audio.deviceId = { exact: deviceId };
    return { audio: Object.keys(audio).length ? audio : true, video: false };
  }

  const video: MediaTrackConstraints = relaxed ? {} : { ...videoConstraints };
  if (deviceId) video.deviceId = { exact: deviceId };
  return { audio: false, video: Object.keys(video).length ? video : true };
}

function pickTrack(kind: MediaKind, stream: MediaStream): MediaStreamTrack {
  const track =
    kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  if (!track) throw new Error("El navegador no entregó una pista.");
  for (const extra of stream.getTracks()) {
    if (extra !== track) extra.stop();
  }
  return track;
}

export async function captureLocalTrack(
  kind: MediaKind,
  deviceId?: string,
): Promise<MediaStreamTrack> {
  const syntheticProfile = syntheticProfileForDevice(deviceId);
  if (syntheticProfile) return createSyntheticTrack(kind, syntheticProfile);
  if (deviceId?.startsWith("qa-synthetic-")) {
    throw new Error(
      "Los dispositivos QA solo están habilitados en staging/desarrollo.",
    );
  }
  const attempts: MediaStreamConstraints[] = [
    mediaConstraintsFor(kind, deviceId, false),
  ];
  if (deviceId) {
    attempts.push(mediaConstraintsFor(kind, undefined, false));
  }
  attempts.push(mediaConstraintsFor(kind, undefined, true));

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return pickTrack(kind, stream);
    } catch (cause) {
      lastError = cause;
      const name = cause instanceof DOMException ? cause.name : "";
      if (name !== "OverconstrainedError" && name !== "NotFoundError") {
        throw cause;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo activar el dispositivo.");
}

export function classifyMediaDeviceError(cause: unknown): string {
  if (cause instanceof DOMException) {
    if (cause.name === "NotAllowedError") {
      return "Permiso denegado por el navegador.";
    }
    if (cause.name === "NotReadableError") {
      return "La cámara o el micrófono están en uso por otra aplicación.";
    }
    if (cause.name === "NotFoundError") {
      return "No se encontró el dispositivo seleccionado.";
    }
    if (cause.name === "OverconstrainedError") {
      return "El dispositivo no acepta la calidad pedida. Prueba otro en Dispositivos.";
    }
    if (cause.name === "InvalidStateError") {
      return "La sesión de medios se desincronizó. Recarga e inténtalo de nuevo.";
    }
  }
  if (cause instanceof Error) {
    if (/\(410\)/u.test(cause.message)) {
      return "La sesión de cámara/micrófono expiró. Vuelve a encender el dispositivo.";
    }
    if (/transceiver type does not match/iu.test(cause.message)) {
      return "No se pudo negociar cámara y micrófono juntos. Vuelve a intentar.";
    }
    if (cause.message.trim()) return cause.message;
  }
  return "No se pudo activar el dispositivo.";
}
