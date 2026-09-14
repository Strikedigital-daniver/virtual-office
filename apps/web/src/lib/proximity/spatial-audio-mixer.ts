/**
 * One shared AudioContext routes remote streams through per-participant GainNodes.
 *
 * Fallback: if Web Audio is missing or createMediaStreamSource throws, attach()
 * returns false and the UI may play HTMLMediaElement.volume. That path is not
 * used when GainNode is available.
 */
export type SpatialAudioGraph = {
  source: { disconnect(): void };
  gain: {
    connect(destination: unknown): void;
    disconnect(): void;
    gain: {
      value: number;
      setTargetAtTime(
        value: number,
        startTime: number,
        timeConstant: number,
      ): void;
    };
  };
  stream: MediaStream;
};

export type SpatialAudioContext = {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaStreamSource(stream: MediaStream): {
    connect(destination: unknown): void;
    disconnect(): void;
  };
  createGain(): SpatialAudioGraph["gain"];
};

export type SpatialAudioContextFactory = () => SpatialAudioContext;

/** Minimum gain delta before touching the GainNode (avoids zipper noise at 10Hz). */
export const GAIN_UPDATE_EPSILON = 0.001;

export function webAudioIsAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof AudioContext !== "undefined" ||
    typeof (window as Window & { webkitAudioContext?: unknown })
      .webkitAudioContext !== "undefined"
  );
}

function registerE2eMixerAnalyser(
  streamKey: string,
  ownerUserId: string | undefined,
  context: SpatialAudioContext,
  gain: SpatialAudioGraph["gain"],
): void {
  if (typeof window === "undefined") return;
  const e2e = (
    window as Window & {
      __voE2e?: {
        registerMixerAnalyser?: (input: {
          streamKey: string;
          ownerUserId: string | null;
          analyser: AnalyserNode;
          readGain: () => number;
          sampleRate: number;
        }) => void;
        unregisterMixerAnalyser?: (streamKey: string) => void;
      };
    }
  ).__voE2e;
  if (!e2e?.registerMixerAnalyser) return;
  const analyser = (
    context as unknown as AudioContext
  ).createAnalyser() as AnalyserNode;
  analyser.fftSize = 2048;
  gain.connect(analyser);
  e2e.registerMixerAnalyser({
    streamKey,
    ownerUserId: ownerUserId ?? null,
    analyser,
    readGain: () => gain.gain.value,
    sampleRate: (context as unknown as AudioContext).sampleRate,
  });
}

function unregisterE2eMixerAnalyser(streamKey: string): void {
  if (typeof window === "undefined") return;
  (
    window as Window & {
      __voE2e?: { unregisterMixerAnalyser?: (streamKey: string) => void };
    }
  ).__voE2e?.unregisterMixerAnalyser?.(streamKey);
}

function defaultContextFactory(): SpatialAudioContext {
  const Ctor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio is not available");
  }
  return new Ctor() as unknown as SpatialAudioContext;
}

export class SpatialAudioMixer {
  private context: SpatialAudioContext | null = null;
  private contextsCreated = 0;
  private gestureUnlocked = false;
  private readonly nodes = new Map<string, SpatialAudioGraph>();
  private readonly appliedGain = new Map<string, number>();

  constructor(
    private readonly createContext: SpatialAudioContextFactory | null = null,
  ) {}

  contextCount(): number {
    return this.contextsCreated;
  }

  isGestureUnlocked(): boolean {
    return this.gestureUnlocked;
  }

  audioContextState(): string | null {
    return this.context?.state ?? null;
  }

  attachedKeys(): string[] {
    return [...this.nodes.keys()];
  }

  has(streamKey: string): boolean {
    return this.nodes.has(streamKey);
  }

  currentGain(streamKey: string): number | null {
    const node = this.nodes.get(streamKey);
    return node ? node.gain.gain.value : null;
  }

  unlock(): void {
    this.gestureUnlocked = true;
    // Create/resume synchronously inside the gesture, even before remotes arrive.
    this.ensureContext();
    this.ensurePlayback();
  }

  /** Resume a suspended context whenever the browser allows it. */
  ensurePlayback(): void {
    const context = this.context;
    if (!context || context.state !== "suspended") return;
    void context.resume().catch(() => undefined);
  }

  attach(
    streamKey: string,
    stream: MediaStream,
    options?: { ownerUserId?: string },
  ): boolean {
    const existing = this.nodes.get(streamKey);
    if (existing && existing.stream === stream) return true;

    const context = this.ensureContext();
    if (!context) return false;
    if (!stream.getAudioTracks()[0]) return false;

    this.detach(streamKey);
    try {
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(context.destination);
      this.nodes.set(streamKey, { source, gain, stream });
      registerE2eMixerAnalyser(
        streamKey,
        options?.ownerUserId,
        context,
        gain,
      );
      this.ensurePlayback();
      return true;
    } catch {
      return false;
    }
  }

  setGain(streamKey: string, gainValue: number): void {
    const node = this.nodes.get(streamKey);
    if (!node) return;
    const clamped = Math.min(1, Math.max(0, gainValue));
    const previous = this.appliedGain.get(streamKey);
    if (
      previous !== undefined &&
      Math.abs(previous - clamped) < GAIN_UPDATE_EPSILON
    ) {
      return;
    }
    node.gain.gain.value = clamped;
    this.appliedGain.set(streamKey, clamped);
  }

  /** Drop graph nodes but keep the shared AudioContext (used after a user gesture). */
  resetAttachments(): void {
    for (const key of [...this.nodes.keys()]) this.detach(key);
  }

  detach(streamKey: string): void {
    unregisterE2eMixerAnalyser(streamKey);
    const node = this.nodes.get(streamKey);
    if (!node) return;
    try {
      node.source.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      node.gain.disconnect();
    } catch {
      // Already disconnected.
    }
    this.nodes.delete(streamKey);
    this.appliedGain.delete(streamKey);
  }

  dispose(): void {
    for (const key of [...this.nodes.keys()]) this.detach(key);
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => undefined);
  }

  private ensureContext(): SpatialAudioContext | null {
    if (this.context) return this.context;
    if (!this.createContext && !webAudioIsAvailable()) return null;
    try {
      const factory = this.createContext ?? defaultContextFactory;
      this.context = factory();
      this.contextsCreated += 1;
      return this.context;
    } catch {
      return null;
    }
  }
}

export function syncSpatialAudioGraph(
  mixer: SpatialAudioMixer,
  remotes: Array<{
    key: string;
    stream: MediaStream;
    ref: { kind: string; ownerUserId: string };
    subscribed: boolean;
    audioGain: number;
  }>,
  options?: { forceHtmlPlayback?: boolean },
): { attached: string[]; fallbackKeys: string[] } {
  const desired = remotes.filter((media) => media.ref.kind === "audio");
  const desiredKeys = new Set(desired.map((media) => media.key));
  const fallbackKeys: string[] = [];

  if (options?.forceHtmlPlayback) {
    for (const key of mixer.attachedKeys()) mixer.detach(key);
    for (const media of desired) fallbackKeys.push(media.key);
    return { attached: [], fallbackKeys };
  }

  for (const media of desired) {
    if (
      mixer.attach(media.key, media.stream, {
        ownerUserId: media.ref.ownerUserId,
      })
    ) {
      mixer.setGain(media.key, media.audioGain);
    } else {
      fallbackKeys.push(media.key);
    }
  }

  for (const key of mixer.attachedKeys()) {
    if (!desiredKeys.has(key)) mixer.detach(key);
  }

  return {
    attached: mixer.attachedKeys(),
    fallbackKeys,
  };
}

/**
 * Chromium does not feed remote WebRTC audio into WebAudio unless the track is
 * also attached to a playing HTMLMediaElement. Every subscribed audio track
 * therefore keeps a muted warm-up <audio> element; only fallback/bypass keys
 * are audible through HTML (the mixer handles audible output otherwise).
 */
export function audibleHtmlAudioKeys(
  remotes: Array<{
    key: string;
    ref: { kind: string; ownerUserId: string };
    subscribed: boolean;
  }>,
  fallbackKeys: string[],
  forceHtmlPlayback: boolean,
): Set<string> {
  const audio = remotes.filter((media) => media.ref.kind === "audio");
  if (forceHtmlPlayback) {
    return new Set(audio.map((media) => media.key));
  }
  const fallback = new Set(fallbackKeys);
  return new Set(
    audio.filter((media) => fallback.has(media.key)).map((media) => media.key),
  );
}

/** Users whose proximity audio is routed (HTML or WebAudio). */
export function proximityAudioOwnerIds(
  remotes: Array<{
    ref: { kind: string; ownerUserId: string };
    subscribed: boolean;
  }>,
): Set<string> {
  return new Set(
    remotes
      .filter((media) => media.ref.kind === "audio" && media.subscribed)
      .map((media) => media.ref.ownerUserId),
  );
}

/** Remote users whose audio is routed through the shared GainNode graph. */
export function mixerRoutedOwnerIds(
  remotes: Array<{
    key: string;
    ref: { kind: string; ownerUserId: string };
    subscribed: boolean;
  }>,
  fallbackKeys: string[],
): Set<string> {
  const fallback = new Set(fallbackKeys);
  return new Set(
    remotes
      .filter(
        (media) =>
          media.ref.kind === "audio" &&
          media.subscribed &&
          !fallback.has(media.key),
      )
      .map((media) => media.ref.ownerUserId),
  );
}

/**
 * Prevent double-playback when proximity audio is routed for this user.
 */
export function shouldMuteRemoteVideoAudio(
  ownerUserId: string,
  proximityAudioOwners: Set<string>,
): boolean {
  return proximityAudioOwners.has(ownerUserId);
}
