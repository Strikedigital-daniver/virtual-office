import type { MediaKind } from "@virtual-office/shared";

export type SyntheticMediaProfile = "alpha" | "beta";
export const SYNTHETIC_PROFILES = {
  alpha: { label: "QA Alpha", frequencyHz: 440 },
  beta: { label: "QA Beta", frequencyHz: 880 },
} as const;

/** Explicit opt-in; never changes authentication, authorization or transport. */
export function syntheticProfileForDevice(
  deviceId: string | undefined,
  environment = process.env.NEXT_PUBLIC_APP_ENV,
): SyntheticMediaProfile | null {
  if (environment !== "staging" && environment !== "development") return null;
  if (deviceId === "qa-synthetic-alpha") return "alpha";
  if (deviceId === "qa-synthetic-beta") return "beta";
  return null;
}

function withCleanup(
  track: MediaStreamTrack,
  cleanup: () => void,
): MediaStreamTrack {
  const stop = track.stop.bind(track);
  let cleaned = false;
  const release = () => {
    if (cleaned) return;
    cleaned = true;
    track.removeEventListener("ended", release);
    window.removeEventListener("pagehide", onPageHide);
    cleanup();
  };
  const onPageHide = () => track.stop();
  track.addEventListener("ended", release, { once: true });
  window.addEventListener("pagehide", onPageHide, { once: true });
  track.stop = () => {
    stop();
    release();
  };
  return track;
}

export async function createSyntheticTrack(
  kind: MediaKind,
  profile: SyntheticMediaProfile,
): Promise<MediaStreamTrack> {
  if (kind === "audio") {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const level = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = SYNTHETIC_PROFILES[profile].frequencyHz;
    level.gain.value = 0.08;
    oscillator.connect(level);
    level.connect(destination); // Only the outgoing track, never local speakers.
    oscillator.start();
    const track = destination.stream.getAudioTracks()[0];
    const cleanup = () => {
      oscillator.stop();
      oscillator.disconnect();
      level.disconnect();
      void context.close().catch(() => undefined);
    };
    try {
      await context.resume();
      if (!track) throw new Error("No se pudo generar audio QA.");
      return withCleanup(track, cleanup);
    } catch (error) {
      track?.stop();
      cleanup();
      throw error;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const drawing = canvas.getContext("2d");
  if (!drawing || typeof canvas.captureStream !== "function") {
    throw new Error("Este navegador no permite generar video QA.");
  }
  let frame = 0;
  const draw = () => {
    const brightness = Math.round(190 + 45 * Math.sin(frame / 5));
    drawing.fillStyle =
      profile === "alpha"
        ? `rgb(${brightness},20,20)`
        : `rgb(20,20,${brightness})`;
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = "white";
    drawing.font = "24px sans-serif";
    drawing.fillText(SYNTHETIC_PROFILES[profile].label, 16, 40);
    drawing.fillText(`Frame ${frame}`, 16, 80);
    drawing.fillRect((frame * 8) % 280, 150, 40, 40);
    frame++;
  };
  draw();
  const track = canvas.captureStream(10).getVideoTracks()[0];
  if (!track) throw new Error("No se pudo generar video QA.");
  const timer = window.setInterval(draw, 100);
  return withCleanup(track, () => {
    window.clearInterval(timer);
    canvas.width = 0;
    canvas.height = 0;
  });
}
