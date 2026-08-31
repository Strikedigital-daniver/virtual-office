export interface StoppableTrack {
  enabled: boolean;
  stop(): void;
}

export interface DetachableSender {
  replaceTrack(track: null): Promise<void>;
}

export interface StoppableTransceiver {
  stop(): void;
}

/**
 * Hard mute (master spec 9.3): OFF must mean no published track and a released
 * device, never a muted track that keeps the camera light on.
 */
export async function hardStopLocalTrack(input: {
  track: StoppableTrack;
  sender?: DetachableSender;
  transceiver?: StoppableTransceiver;
}): Promise<void> {
  input.track.enabled = false;
  input.track.stop();
  try {
    await input.sender?.replaceTrack(null);
  } finally {
    input.transceiver?.stop();
  }
}
