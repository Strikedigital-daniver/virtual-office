import type { Page } from "@playwright/test";

export interface RtpInboundSample {
  kind: string;
  bytesReceived: number;
  framesDecoded?: number;
  packetsReceived?: number;
  audioLevel?: number;
  totalAudioEnergy?: number;
}

export interface AudioPlaybackSample {
  paused: boolean;
  volume: number;
  readyState: number;
  currentTime: number;
  muted: boolean;
}

export interface VideoFrameSample {
  width: number;
  height: number;
  dominantRgb: { r: number; g: number; b: number };
  variance: number;
}

export interface MediaEvidence {
  capturedAt: string;
  label: string;
  remoteLabel: string;
  remoteUserId: string;
  rtpInbound: RtpInboundSample[];
  rtpInboundDelta?: RtpInboundSample[];
  ontrackEvents: number;
  audioPlayback: AudioPlaybackSample[];
  mixerGain: number | null;
  audioPeakFrequencyHz: number | null;
  audioRms: number | null;
  videoFrames: VideoFrameSample[];
  videoFrameChanged: boolean;
  playRejections: Array<{ message: string; tag: string; paused: boolean }>;
  iceStates: Array<{ connectionState: string; iceConnectionState: string }>;
  consoleErrors: string[];
  proximity?: {
    distance: number;
    audioFactor: number;
    videoFactor: number;
    audioSubscribed: boolean;
    videoSubscribed: boolean;
    zone: string;
  };
}

async function sampleVideoFrame(
  page: Page,
  selector: string,
): Promise<VideoFrameSample | null> {
  return page.evaluate(async (videoSelector) => {
    const video = document.querySelector(
      videoSelector,
    ) as HTMLVideoElement | null;
    if (!video || video.readyState < 2) return null;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let variance = 0;
    const pixels = width * height;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const avgR = r / pixels;
    const avgG = g / pixels;
    const avgB = b / pixels;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - avgR;
      const dg = data[i + 1] - avgG;
      const db = data[i + 2] - avgB;
      variance += dr * dr + dg * dg + db * db;
    }
    variance /= pixels;
    return {
      width,
      height,
      dominantRgb: {
        r: Math.round(avgR),
        g: Math.round(avgG),
        b: Math.round(avgB),
      },
      variance,
    };
  }, selector);
}

async function measureAudioFromMixerTap(
  page: Page,
  remoteUserId: string,
): Promise<{
  peakFrequencyHz: number | null;
  rms: number | null;
  mixerGain: number | null;
}> {
  return page.evaluate(async (peerUserId) => {
    const vo = window.__voE2e;
    if (!vo?.mixerAnalyzers) {
      return { peakFrequencyHz: null, rms: null, mixerGain: null };
    }

    let tap: {
      analyser: AnalyserNode;
      readGain: () => number;
      sampleRate: number;
    } | null = null;
    for (const entry of vo.mixerAnalyzers.values()) {
      if (entry.ownerUserId === peerUserId) {
        tap = entry;
        break;
      }
    }
    if (!tap) return { peakFrequencyHz: null, rms: null, mixerGain: null };

    const gain = tap.readGain();
    if (gain <= 0.001) {
      return { peakFrequencyHz: null, rms: 0, mixerGain: gain };
    }

    await new Promise((resolve) => setTimeout(resolve, 450));
    const bins = new Uint8Array(tap.analyser.frequencyBinCount);
    tap.analyser.getByteFrequencyData(bins);
    let peakIndex = 0;
    let peakValue = 0;
    let sumSquares = 0;
    for (let i = 0; i < bins.length; i += 1) {
      sumSquares += bins[i] * bins[i];
      if (bins[i] > peakValue) {
        peakValue = bins[i];
        peakIndex = i;
      }
    }
    const peakFrequencyHz =
      peakValue > 8 ? (peakIndex * tap.sampleRate) / tap.analyser.fftSize : null;
    const rms = Math.sqrt(sumSquares / bins.length);
    return { peakFrequencyHz, rms, mixerGain: gain };
  }, remoteUserId);
}

export async function collectRtpInbound(
  page: Page,
): Promise<RtpInboundSample[]> {
  return page.evaluate(async () => {
    const vo = window.__voE2e;
    if (!vo) return [];
    const samples: RtpInboundSample[] = [];
    for (const pc of vo.peerConnections) {
      const report = await pc.getStats();
      for (const stat of report.values()) {
        if (stat.type !== "inbound-rtp") continue;
        const kind = String(stat.kind ?? "unknown");
        samples.push({
          kind,
          bytesReceived: Number(stat.bytesReceived ?? 0),
          framesDecoded:
            stat.framesDecoded !== undefined
              ? Number(stat.framesDecoded)
              : undefined,
          packetsReceived:
            stat.packetsReceived !== undefined
              ? Number(stat.packetsReceived)
              : undefined,
          audioLevel:
            stat.audioLevel !== undefined ? Number(stat.audioLevel) : undefined,
          totalAudioEnergy:
            stat.totalAudioEnergy !== undefined
              ? Number(stat.totalAudioEnergy)
              : undefined,
        });
      }
    }
    return samples;
  });
}

function deltaRtp(
  before: RtpInboundSample[],
  after: RtpInboundSample[],
): RtpInboundSample[] {
  const beforeByKind = new Map(before.map((s) => [s.kind, s]));
  return after.map((sample) => {
    const prev = beforeByKind.get(sample.kind);
    return {
      kind: sample.kind,
      bytesReceived: sample.bytesReceived - (prev?.bytesReceived ?? 0),
      framesDecoded:
        sample.framesDecoded !== undefined
          ? (sample.framesDecoded ?? 0) - (prev?.framesDecoded ?? 0)
          : undefined,
      packetsReceived:
        sample.packetsReceived !== undefined
          ? (sample.packetsReceived ?? 0) - (prev?.packetsReceived ?? 0)
          : undefined,
      audioLevel: sample.audioLevel,
      totalAudioEnergy: sample.totalAudioEnergy,
    };
  });
}

export async function collectMediaEvidence(
  page: Page,
  input: {
    label: string;
    remoteLabel: string;
    remoteUserId: string;
    previousRtp?: RtpInboundSample[];
    previousVideo?: VideoFrameSample | null;
    proximity?: MediaEvidence["proximity"];
  },
): Promise<MediaEvidence> {
  const rtpInbound = await collectRtpInbound(page);
  const rtpInboundDelta = input.previousRtp
    ? deltaRtp(input.previousRtp, rtpInbound)
    : undefined;

  const instrumentation = await page.evaluate(() => {
    const vo = window.__voE2e;
    return {
      ontrackEvents:
        vo?.negotiationEvents?.filter((e) => e.type === "ontrack").length ?? 0,
      playRejections: vo?.playRejections ?? [],
      iceStates: vo?.iceStates ?? [],
      consoleErrors: vo?.consoleErrors?.map((e) => e.line) ?? [],
      audioPlayback: Array.from(
        document.querySelectorAll(".proximity-audio-playback audio"),
      ).map((el) => {
        const audio = el as HTMLAudioElement;
        return {
          paused: audio.paused,
          volume: audio.volume,
          readyState: audio.readyState,
          currentTime: audio.currentTime,
          muted: audio.muted,
        };
      }),
    };
  });

  const videoSelector = `figure.media-tile[data-user-id="${input.remoteUserId}"] video.participant-tile-video`;
  const videoFrame1 = await sampleVideoFrame(page, videoSelector);
  await page.waitForTimeout(500);
  const videoFrame2 = await sampleVideoFrame(page, videoSelector);
  const videoFrameChanged =
    videoFrame1 !== null &&
    videoFrame2 !== null &&
    (Math.abs(videoFrame1.dominantRgb.r - videoFrame2.dominantRgb.r) > 2 ||
      Math.abs(videoFrame1.dominantRgb.g - videoFrame2.dominantRgb.g) > 2 ||
      Math.abs(videoFrame1.dominantRgb.b - videoFrame2.dominantRgb.b) > 2 ||
      Math.abs(videoFrame1.variance - videoFrame2.variance) > 1);

  const audioMetrics = await measureAudioFromMixerTap(
    page,
    input.remoteUserId,
  );

  return {
    capturedAt: new Date().toISOString(),
    label: input.label,
    remoteLabel: input.remoteLabel,
    remoteUserId: input.remoteUserId,
    rtpInbound,
    rtpInboundDelta,
    ontrackEvents: instrumentation.ontrackEvents,
    audioPlayback: instrumentation.audioPlayback,
    mixerGain: audioMetrics.mixerGain,
    audioPeakFrequencyHz: audioMetrics.peakFrequencyHz,
    audioRms: audioMetrics.rms,
    videoFrames: [videoFrame1, videoFrame2].filter(
      (frame): frame is VideoFrameSample => frame !== null,
    ),
    videoFrameChanged,
    playRejections: instrumentation.playRejections.map((r) => ({
      message: r.message,
      tag: r.tag,
      paused: r.paused,
    })),
    iceStates: instrumentation.iceStates.map((s) => ({
      connectionState: s.connectionState,
      iceConnectionState: s.iceConnectionState,
    })),
    consoleErrors: instrumentation.consoleErrors,
    proximity: input.proximity,
  };
}

export function evaluateAudioEvidence(
  evidence: MediaEvidence,
  expectedPeakHz: number,
  toleranceHz = 120,
): "PASS" | "FAIL" | "BLOCKED" {
  const audioDelta = evidence.rtpInboundDelta?.find((s) => s.kind === "audio");
  const bytesGrowing = (audioDelta?.bytesReceived ?? 0) > 0;
  const freqMatch =
    evidence.audioPeakFrequencyHz !== null &&
    Math.abs(evidence.audioPeakFrequencyHz - expectedPeakHz) <= toleranceHz;
  const mixerAudible =
    (evidence.mixerGain ?? 0) > 0.05 &&
    evidence.audioRms !== null &&
    evidence.audioRms > 6 &&
    freqMatch;

  if (!bytesGrowing && evidence.rtpInbound.every((s) => s.kind !== "audio")) {
    return "BLOCKED";
  }
  if (mixerAudible && bytesGrowing) return "PASS";
  if (bytesGrowing && (evidence.mixerGain ?? 0) <= 0.05) {
    return evidence.audioRms !== null && evidence.audioRms <= 2 ? "PASS" : "FAIL";
  }
  return "FAIL";
}

export function evaluateSilentAudioEvidence(
  evidence: MediaEvidence,
): "PASS" | "FAIL" | "BLOCKED" {
  const audioDelta = evidence.rtpInboundDelta?.find((s) => s.kind === "audio");
  const bytesGrowing = (audioDelta?.bytesReceived ?? 0) > 0;
  const silentMixer =
    (evidence.mixerGain ?? 1) <= 0.05 ||
    (evidence.audioRms !== null && evidence.audioRms <= 2);
  if (!bytesGrowing) return "BLOCKED";
  return silentMixer ? "PASS" : "FAIL";
}

export function evaluateVideoEvidence(
  evidence: MediaEvidence,
  expectedColor: "red" | "blue",
): "PASS" | "FAIL" | "BLOCKED" {
  const videoDelta = evidence.rtpInboundDelta?.find((s) => s.kind === "video");
  const bytesGrowing = (videoDelta?.bytesReceived ?? 0) > 0;
  const framesGrowing = (videoDelta?.framesDecoded ?? 0) > 0;
  const frame = evidence.videoFrames.at(-1);
  if (!frame) {
    return bytesGrowing ? "FAIL" : "BLOCKED";
  }
  const { r, g, b } = frame.dominantRgb;
  const colorMatch =
    expectedColor === "red"
      ? r > g + 30 && r > b + 30
      : b > r + 30 && b > g + 30;
  if (
    bytesGrowing &&
    framesGrowing &&
    colorMatch &&
    evidence.videoFrameChanged
  ) {
    return "PASS";
  }
  if (bytesGrowing && !colorMatch) return "FAIL";
  return "FAIL";
}

declare global {
  interface Window {
    __voE2e?: {
      peerConnections: RTCPeerConnection[];
      playRejections: Array<{
        message: string;
        tag: string;
        paused: boolean;
      }>;
      negotiationEvents: Array<{ type?: string }>;
      iceStates: Array<{
        connectionState: string;
        iceConnectionState: string;
      }>;
      consoleErrors: Array<{ line: string }>;
      mixerAnalyzers: Map<
        string,
        {
          ownerUserId: string | null;
          analyser: AnalyserNode;
          readGain: () => number;
          sampleRate: number;
        }
      >;
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
}
