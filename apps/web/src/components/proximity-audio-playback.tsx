"use client";

import { useCallback, useEffect, useRef } from "react";

import type { RemoteMedia } from "@/lib/media/use-office-media";
import {
  SPATIAL_AUDIO_UNLOCK_EVENT,
  type HtmlAudioPlaybackState,
} from "@/lib/proximity/html-audio-playback";
import { sanitizeMediaError } from "@/lib/spatial-debug/media-diagnostics";

/**
 * `warmupMuted` elements exist because Chromium delivers no audio data to
 * WebAudio (createMediaStreamSource) for a remote WebRTC track unless that
 * track is also attached to a playing HTMLMediaElement. Muted autoplay is
 * always allowed, so warm-up elements start before any user gesture and the
 * mixer becomes audible as soon as the AudioContext resumes.
 */
function ProximityAudioElement({
  media,
  warmupMuted,
  onPlaybackState,
}: {
  media: RemoteMedia;
  warmupMuted: boolean;
  onPlaybackState?: (state: HtmlAudioPlaybackState) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackReporterRef = useRef(onPlaybackState);
  playbackReporterRef.current = onPlaybackState;
  const report = useCallback(
    (state: HtmlAudioPlaybackState["state"], error: string | null = null) => {
      playbackReporterRef.current?.({ key: media.key, state, error });
    },
    [media.key],
  );
  const playPromiseRef = useRef<Promise<void> | null>(null);

  const track = media.stream.getAudioTracks()[0] ?? null;

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !track) {
      report("inactive");
      return;
    }

    const stream = new MediaStream([track]);
    element.srcObject = stream;

    const onEnded = () => {
      playPromiseRef.current = null;
      element.pause();
      report("inactive");
    };
    track.addEventListener("ended", onEnded);

    return () => {
      track.removeEventListener("ended", onEnded);
      playPromiseRef.current = null;
      element.pause();
      element.srcObject = null;
    };
  }, [track, report]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !track) return;

    const syncPlayback = () => {
      element.muted = warmupMuted;
      const gain = media.subscribed ? media.audioGain : 0;
      element.volume = warmupMuted ? 0 : Math.min(1, Math.max(0, gain));
      // Warm-up transport stays playing at zero volume; the graph owns gain.
      const shouldPlay =
        track.readyState === "live" && (warmupMuted || gain > 0.001);
      if (!shouldPlay) {
        playPromiseRef.current = null;
        if (!element.paused) element.pause();
        report("paused");
        return;
      }
      if (!element.paused) {
        report("playing");
        return;
      }
      if (playPromiseRef.current) return;
      const attempt = element.play();
      playPromiseRef.current = attempt;
      void attempt.then(
        () => {
          if (playPromiseRef.current !== attempt) return;
          playPromiseRef.current = null;
          report("playing");
        },
        (cause) => {
          if (playPromiseRef.current !== attempt) return;
          playPromiseRef.current = null;
          const message = sanitizeMediaError(cause);
          const isLoadRaceNoise =
            message.includes("interrupted by a call to pause") ||
            message.includes("interrupted by a new load request");
          if (!isLoadRaceNoise) report("blocked", message);
        },
      );
    };

    syncPlayback();
    track.addEventListener("unmute", syncPlayback);
    track.addEventListener("mute", syncPlayback);
    const onUnlock = () => syncPlayback();
    window.addEventListener(SPATIAL_AUDIO_UNLOCK_EVENT, onUnlock);

    return () => {
      track.removeEventListener("unmute", syncPlayback);
      track.removeEventListener("mute", syncPlayback);
      window.removeEventListener(SPATIAL_AUDIO_UNLOCK_EVENT, onUnlock);
    };
  }, [
    media.key,
    media.audioGain,
    media.subscribed,
    warmupMuted,
    track,
    report,
  ]);

  return (
    <audio
      ref={audioRef}
      autoPlay
      playsInline
      muted={warmupMuted}
      className="sr-only"
    />
  );
}

export function ProximityAudioPlayback({
  remotes,
  audibleKeys,
  enabled = true,
  onPlaybackState,
}: {
  remotes: RemoteMedia[];
  /** Keys audible through HTML; every other subscribed track gets a muted warm-up element. */
  audibleKeys?: ReadonlySet<string>;
  enabled?: boolean;
  onPlaybackState?: (state: HtmlAudioPlaybackState) => void;
}) {
  if (!enabled) return null;
  const audios = remotes.filter((media) => {
    if (media.ref.kind !== "audio") return false;
    const track = media.stream.getAudioTracks()[0];
    return Boolean(track && track.readyState === "live");
  });
  if (audios.length === 0) return null;
  return (
    <div className="proximity-audio-playback" aria-hidden="true">
      {audios.map((media) => (
        <ProximityAudioElement
          key={media.key}
          media={media}
          warmupMuted={audibleKeys ? !audibleKeys.has(media.key) : false}
          {...(onPlaybackState ? { onPlaybackState } : {})}
        />
      ))}
    </div>
  );
}
