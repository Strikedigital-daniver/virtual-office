import { describe, expect, it, vi } from "vitest";
import { hardStopLocalTrack } from "../src/client/media-lifecycle";

describe("hard mute", () => {
  it("disables and stops capture before detaching and stopping the transceiver", async () => {
    const calls: string[] = [];
    const track = {
      enabled: true,
      stop: vi.fn(() => calls.push("track.stop")),
    };
    const sender = {
      replaceTrack: vi.fn(async () => {
        calls.push("sender.replaceTrack(null)");
      }),
    };
    const transceiver = {
      stop: vi.fn(() => calls.push("transceiver.stop")),
    };

    await hardStopLocalTrack({ track, sender, transceiver });

    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(sender.replaceTrack).toHaveBeenCalledWith(null);
    expect(transceiver.stop).toHaveBeenCalledOnce();
    expect(calls).toEqual(["track.stop", "sender.replaceTrack(null)", "transceiver.stop"]);
  });

  it("still stops the transceiver when sender detachment fails", async () => {
    const track = { enabled: true, stop: vi.fn() };
    const sender = {
      replaceTrack: vi.fn(async () => {
        throw new Error("sender already closed");
      }),
    };
    const transceiver = { stop: vi.fn() };

    await expect(hardStopLocalTrack({ track, sender, transceiver })).rejects.toThrow(
      "sender already closed",
    );

    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(transceiver.stop).toHaveBeenCalledOnce();
  });
});
