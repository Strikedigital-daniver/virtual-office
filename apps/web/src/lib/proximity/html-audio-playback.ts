export type HtmlAudioPlaybackState = {
  key: string;
  state: "inactive" | "playing" | "paused" | "blocked";
  error: string | null;
};

export const SPATIAL_AUDIO_UNLOCK_EVENT = "spatial-audio-unlock";
