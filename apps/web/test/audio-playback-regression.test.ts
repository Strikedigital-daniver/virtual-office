// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityAudioPlayback } from "@/components/proximity-audio-playback";
import type { RemoteMedia } from "@/lib/media/use-office-media";

let root: Root;
let host: HTMLDivElement;
let assignments: unknown[];
class TestStream {
  constructor(private tracks: MediaStreamTrack[]) {}
  getAudioTracks() {
    return this.tracks;
  }
}
function remote(): RemoteMedia {
  const track = Object.assign(new EventTarget(), {
    id: "audio-a",
    readyState: "live",
  });
  return {
    key: "session:audio",
    ref: {
      ownerUserId: "a",
      sessionId: "session",
      trackName: "audio",
      kind: "audio",
    },
    stream: new TestStream([
      track as unknown as MediaStreamTrack,
    ]) as unknown as MediaStream,
    displayName: "A",
    audioGain: 1,
    videoOpacity: 1,
    proximityZone: "NEAR" as RemoteMedia["proximityZone"],
    subscribed: true,
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("MediaStream", TestStream);
  assignments = [];
  const sources = new WeakMap<HTMLMediaElement, unknown>();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get() {
      return sources.get(this);
    },
    set(value) {
      sources.set(this, value);
      assignments.push(value);
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)
    .srcObject;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("remote audio element lifecycle", () => {
  it("keeps the same srcObject through position/gain updates and new diagnostic callbacks", async () => {
    const media = remote();
    for (let tick = 0; tick < 12; tick++) {
      await act(async () =>
        root.render(
          createElement(ProximityAudioPlayback, {
            remotes: [{ ...media, audioGain: tick % 2 ? 0 : 1 }],
            audibleKeys: new Set<string>(),
            onPlaybackState: vi.fn(),
          }),
        ),
      );
    }
    expect(assignments.filter(Boolean)).toHaveLength(1);
  });
  it("rebinds only on track replacement and releases srcObject on unmount", async () => {
    const render = async (media: RemoteMedia) =>
      act(async () =>
        root.render(
          createElement(ProximityAudioPlayback, { remotes: [media] }),
        ),
      );
    await render(remote());
    await render(remote());
    expect(assignments.filter(Boolean)).toHaveLength(2);
    const element = host.querySelector("audio")!;
    await act(async () => root.render(null));
    expect(element.srcObject).toBeNull();
  });
  it("reports rejected warm-up play so an autoplay failure is observable", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      new Error("NotAllowedError"),
    );
    const report = vi.fn();
    await act(async () =>
      root.render(
        createElement(ProximityAudioPlayback, {
          remotes: [remote()],
          audibleKeys: new Set<string>(),
          onPlaybackState: report,
        }),
      ),
    );
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "blocked",
        error: expect.stringContaining("NotAllowedError"),
      }),
    );
  });
});
