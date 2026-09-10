import { describe, expect, it } from "vitest";

import {
  assertValidSubscribeResponse,
  isRecoverableSubscribeError,
  midsFromSubscribeResponse,
  partitionSubscribeRefs,
  shouldRecreateRecvOnSubscribeError,
  SubscribeResponseError,
} from "@/lib/media/subscribe-response";
import { isStaleSfuPublicationError } from "@/lib/media/media-provider";

describe("subscribe response validation", () => {
  it("rejects empty mids", () => {
    expect(() =>
      assertValidSubscribeResponse({
        tracks: [],
        requiresImmediateRenegotiation: false,
      }),
    ).toThrow(SubscribeResponseError);
    expect(() =>
      assertValidSubscribeResponse({
        tracks: [{ trackName: "audio-x" }],
        requiresImmediateRenegotiation: true,
        sessionDescription: { type: "offer", sdp: "v=0" },
      }),
    ).toThrow(/no track mids/i);
  });

  it("rejects renegotiation without SDP", () => {
    expect(() =>
      assertValidSubscribeResponse({
        tracks: [{ mid: "0", trackName: "audio-x" }],
        requiresImmediateRenegotiation: true,
      }),
    ).toThrow(/omitted the session description/i);
  });

  it("rejects mids without negotiation offer", () => {
    expect(() =>
      assertValidSubscribeResponse({
        tracks: [{ mid: "0", trackName: "audio-x" }],
      }),
    ).toThrow(/without a renegotiation offer/i);
  });

  it("treats SFU 410 as recoverable for subscribe retry", () => {
    expect(
      isRecoverableSubscribeError(new Error("Media call failed (410)")),
    ).toBe(true);
    expect(
      isStaleSfuPublicationError(new Error("Media call failed (410)")),
    ).toBe(true);
  });

  it("does not treat NO_MIDS as a stale catalog entry (publisher may still be connecting)", () => {
    expect(
      isStaleSfuPublicationError(
        new SubscribeResponseError(
          "SFU subscribe returned no track mids.",
          "NO_MIDS",
        ),
      ),
    ).toBe(false);
  });

  it("does not recreate the recv session on NO_MIDS", () => {
    expect(
      shouldRecreateRecvOnSubscribeError(
        new SubscribeResponseError(
          "SFU subscribe returned no track mids.",
          "NO_MIDS",
        ),
      ),
    ).toBe(false);
    expect(
      shouldRecreateRecvOnSubscribeError(new Error("Media call failed (410)")),
    ).toBe(true);
  });

  it("subscribes audio independently from video", () => {
    expect(
      partitionSubscribeRefs([
        { kind: "audio" },
        { kind: "video" },
        { kind: "audio" },
      ]),
    ).toEqual({
      audio: [{ kind: "audio" }, { kind: "audio" }],
      video: [{ kind: "video" }],
    });
  });

  it("accepts mids with SDP offer", () => {
    const mids = assertValidSubscribeResponse({
      tracks: [{ mid: "mid-a", trackName: "audio-x" }],
      requiresImmediateRenegotiation: true,
      sessionDescription: { type: "offer", sdp: "v=0" },
    });
    expect(mids).toEqual(["mid-a"]);
    expect(
      midsFromSubscribeResponse({
        tracks: [{ mid: "mid-b" }, { trackName: "no-mid" }],
      }),
    ).toEqual(["mid-b"]);
  });
});
