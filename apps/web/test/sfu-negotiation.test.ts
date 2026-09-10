import { describe, expect, it, vi } from "vitest";

import {
  describeSessionDescription,
  isPeerTransportConnected,
  isRecoverableSfuError,
  selectVp8SendCodecs,
  shouldRollbackBeforeRemoteOffer,
  waitForIceGathering,
  waitForPeerTransport,
} from "@/lib/media/sfu-negotiation";
import {
  captureLocalTrack,
  classifyMediaDeviceError,
  mediaConstraintsFor,
} from "@/lib/media/local-media";

describe("sfu negotiation helpers", () => {
  it("describes a complete offer", () => {
    expect(describeSessionDescription({ type: "offer", sdp: "v=0" })).toEqual({
      type: "offer",
      sdp: "v=0",
    });
  });

  it("prefers VP8 for outgoing video", () => {
    expect(
      selectVp8SendCodecs([
        { mimeType: "video/VP9" },
        { mimeType: "video/VP8" },
        { mimeType: "video/rtx" },
      ]),
    ).toEqual([{ mimeType: "video/VP8" }]);
  });

  it("rolls back a local offer before applying a remote offer (glare)", () => {
    expect(shouldRollbackBeforeRemoteOffer("have-local-offer", "offer")).toBe(
      true,
    );
    expect(shouldRollbackBeforeRemoteOffer("stable", "offer")).toBe(false);
    expect(shouldRollbackBeforeRemoteOffer("have-local-offer", "answer")).toBe(
      false,
    );
  });

  it("resolves immediately when ICE gathering is already complete", async () => {
    const pc = {
      iceGatheringState: "complete",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as RTCPeerConnection;
    await waitForIceGathering(pc, 10);
    expect(pc.addEventListener).not.toHaveBeenCalled();
  });

  it("recovers from expired sessions and transceiver mismatches", () => {
    expect(isRecoverableSfuError(new Error("Media call failed (410)"))).toBe(
      true,
    );
    expect(
      isRecoverableSfuError(
        new Error(
          "Failed to execute 'setLocalDescription' on 'RTCPeerConnection': Failed to set local offer sdp: Transceiver type does not match media description type.",
        ),
      ),
    ).toBe(true);
    expect(
      isRecoverableSfuError(new Error("send peer ICE did not connect in time")),
    ).toBe(true);
    expect(isRecoverableSfuError(new Error("permission denied"))).toBe(false);
  });

  it("detects connected peer transports", () => {
    expect(
      isPeerTransportConnected({
        iceConnectionState: "connected",
        connectionState: "new",
      } as RTCPeerConnection),
    ).toBe(true);
    expect(
      isPeerTransportConnected({
        iceConnectionState: "new",
        connectionState: "new",
      } as RTCPeerConnection),
    ).toBe(false);
  });

  it("resolves waitForPeerTransport when ICE connects", async () => {
    const listeners = new Map<string, Set<() => void>>();
    const state = { iceConnectionState: "checking", connectionState: "new" };
    const pc = {
      get iceConnectionState() {
        return state.iceConnectionState;
      },
      get connectionState() {
        return state.connectionState;
      },
      addEventListener: (event: string, handler: () => void) => {
        listeners.set(event, (listeners.get(event) ?? new Set()).add(handler));
      },
      removeEventListener: (event: string, handler: () => void) => {
        listeners.get(event)?.delete(handler);
      },
    } as unknown as RTCPeerConnection;
    const promise = waitForPeerTransport(pc, "send", 50);
    state.iceConnectionState = "connected";
    listeners.get("iceconnectionstatechange")?.forEach((handler) => handler());
    await promise;
  });
});

describe("local media constraints", () => {
  it("asks for exact device id when selected", () => {
    const constraints = mediaConstraintsFor("video", "cam-1");
    expect(constraints.video).toMatchObject({
      deviceId: { exact: "cam-1" },
    });
  });

  it("relaxes to any device when requested", () => {
    expect(mediaConstraintsFor("audio", undefined, true)).toEqual({
      audio: true,
      video: false,
    });
  });

  it("falls back to unconstrained capture after OverconstrainedError", async () => {
    const liveTrack = {
      kind: "video",
      stop: vi.fn(),
    };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("strict", "OverconstrainedError"))
      .mockResolvedValueOnce({
        getAudioTracks: () => [],
        getVideoTracks: () => [liveTrack],
        getTracks: () => [liveTrack],
      });
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });

    await expect(captureLocalTrack("video")).resolves.toBe(liveTrack);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("explains a stuck signaling state", () => {
    expect(
      classifyMediaDeviceError(new DOMException("bad", "InvalidStateError")),
    ).toMatch(/desincronizó/u);
  });
});
