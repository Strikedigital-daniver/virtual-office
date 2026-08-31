import { describe, expect, it, vi } from "vitest";

import { hardStopLocalTrack } from "@/lib/media/track-lifecycle";

describe("hard mute", () => {
  it("disables, stops the device and detaches the sender before stopping the transceiver", async () => {
    const order: string[] = [];
    const track = {
      enabled: true,
      stop: vi.fn(() => order.push("stop")),
    };
    const sender = {
      replaceTrack: vi.fn(async () => {
        order.push("replaceTrack");
      }),
    };
    const transceiver = { stop: vi.fn(() => order.push("transceiver")) };

    await hardStopLocalTrack({ track, sender, transceiver });

    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(sender.replaceTrack).toHaveBeenCalledWith(null);
    expect(order).toEqual(["stop", "replaceTrack", "transceiver"]);
  });

  it("still stops the transceiver when detaching the sender fails", async () => {
    const track = { enabled: true, stop: vi.fn() };
    const sender = {
      replaceTrack: vi.fn(async () => {
        throw new Error("sender gone");
      }),
    };
    const transceiver = { stop: vi.fn() };

    await expect(
      hardStopLocalTrack({ track, sender, transceiver }),
    ).rejects.toThrow("sender gone");
    expect(track.stop).toHaveBeenCalledOnce();
    expect(transceiver.stop).toHaveBeenCalledOnce();
  });

  it("releases the device even without a peer connection attached", async () => {
    const track = { enabled: true, stop: vi.fn() };
    await hardStopLocalTrack({ track });
    expect(track.enabled).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
