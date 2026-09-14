import type { Page } from "@playwright/test";

export const INSTRUMENTATION_INIT = `
(() => {
  if (window.__voE2e) return;
  const state = {
    peerConnections: [],
    playRejections: [],
    consoleErrors: [],
    iceStates: [],
    negotiationEvents: [],
    mixerAnalyzers: new Map(),
  };
  window.__voE2e = state;

  state.registerMixerAnalyser = ({
    streamKey,
    ownerUserId,
    analyser,
    readGain,
    sampleRate,
  }) => {
    state.mixerAnalyzers.set(streamKey, {
      ownerUserId,
      analyser,
      readGain,
      sampleRate,
    });
  };
  state.unregisterMixerAnalyser = (streamKey) => {
    state.mixerAnalyzers.delete(streamKey);
  };

  const OrigPc = window.RTCPeerConnection;
  if (OrigPc) {
    window.RTCPeerConnection = function (...args) {
      const pc = new OrigPc(...args);
      state.peerConnections.push(pc);
      const pushIce = () => {
        state.iceStates.push({
          at: Date.now(),
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState,
        });
      };
      pc.addEventListener("connectionstatechange", pushIce);
      pc.addEventListener("iceconnectionstatechange", pushIce);
      pc.addEventListener("signalingstatechange", () => {
        state.negotiationEvents.push({
          at: Date.now(),
          signalingState: pc.signalingState,
        });
      });
      pc.addEventListener("track", (event) => {
        state.negotiationEvents.push({
          at: Date.now(),
          type: "ontrack",
          kind: event.track?.kind ?? "unknown",
          readyState: event.track?.readyState ?? "unknown",
        });
      });
      return pc;
    };
    window.RTCPeerConnection.prototype = OrigPc.prototype;
  }

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const result = origPlay.apply(this, args);
    if (result && typeof result.catch === "function") {
      return result.catch((error) => {
        state.playRejections.push({
          at: Date.now(),
          tag: this.tagName,
          className: this.className,
          paused: this.paused,
          volume: this.volume,
          readyState: this.readyState,
          message: String(error?.message ?? error).slice(0, 240),
        });
        throw error;
      });
    }
    return result;
  };

  const origError = console.error;
  console.error = (...args) => {
    const line = args
      .map((arg) => {
        try {
          return typeof arg === "string" ? arg : JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ")
      .slice(0, 400);
    if (!/password|token|ticket|secret|bearer /iu.test(line)) {
      state.consoleErrors.push({ at: Date.now(), line });
    }
    origError.apply(console, args);
  };
})();
`;

export async function installInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(INSTRUMENTATION_INIT);
}
