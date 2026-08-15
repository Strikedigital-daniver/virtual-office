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
