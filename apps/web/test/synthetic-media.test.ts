// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyntheticTrack,
  syntheticProfileForDevice,
} from "@/lib/media/synthetic-media";
import { captureLocalTrack } from "@/lib/media/local-media";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("staging virtual devices", () => {
  it("requires an explicit profile and an explicit non-production environment", () => {
    for (const env of ["production", "", "preview"]) {
      expect(syntheticProfileForDevice("qa-synthetic-alpha", env)).toBeNull();
    }
    expect(syntheticProfileForDevice("qa-synthetic-alpha", "staging")).toBe(
      "alpha",
    );
    expect(syntheticProfileForDevice("qa-synthetic-beta", "development")).toBe(
      "beta",
    );
    expect(syntheticProfileForDevice("physical-mic", "staging")).toBeNull();
  });
  it("rejects QA ids in production instead of falling back to a physical microphone", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    await expect(
      captureLocalTrack("audio", "qa-synthetic-alpha"),
    ).rejects.toThrow("solo están habilitados");
  });
  it.each(["alpha", "beta"] as const)(
    "creates %s audio without getUserMedia and releases its generator on stop",
    async (profile) => {
      const track = Object.assign(new EventTarget(), { stop: vi.fn() });
      const stop = track.stop;
      const oscillator = {
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      const level = {
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const destination = { stream: { getAudioTracks: () => [track] } };
      const context = {
        createOscillator: () => oscillator,
        createGain: () => level,
        createMediaStreamDestination: () => destination,
        resume: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      vi.stubGlobal(
        "AudioContext",
        class {
          constructor() {
            return context;
          }
        },
      );
      const result = await createSyntheticTrack("audio", profile);
      expect(oscillator.frequency.value).toBe(profile === "alpha" ? 440 : 880);
      expect(level.connect).toHaveBeenCalledWith(destination);
      result.stop();
      result.stop();
      expect(stop).toHaveBeenCalled();
      expect(oscillator.stop).toHaveBeenCalledOnce();
      expect(context.close).toHaveBeenCalledOnce();
    },
  );
});
