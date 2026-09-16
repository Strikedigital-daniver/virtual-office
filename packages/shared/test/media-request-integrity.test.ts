import { describe, expect, it } from "vitest";
import {
  PublishTracksRequestSchema,
  SubscribeTracksRequestSchema,
} from "../src/realtime-sfu";

describe("media request identity integrity", () => {
  it("rejects duplicate remote tracks that would create untracked receive mids", () => {
    const track = {
      location: "remote",
      sessionId: "publisher-session",
      trackName: "mic",
    };
    expect(
      SubscribeTracksRequestSchema.safeParse({
        sessionId: "receiver-session",
        tracks: [track, track],
      }).success,
    ).toBe(false);
    expect(
      SubscribeTracksRequestSchema.safeParse({
        sessionId: "receiver-session",
        tracks: [track, { ...track, sessionId: "another-publisher" }],
      }).success,
    ).toBe(true);
  });

  it("rejects overlapping publisher names or mids before altering the registry", () => {
    const input = {
      sessionId: "publisher-session",
      sessionDescription: { type: "offer", sdp: "test sdp" },
      tracks: [
        { location: "local", mid: "0", trackName: "audio", kind: "audio" },
        { location: "local", mid: "1", trackName: "video", kind: "video" },
      ],
    };
    expect(PublishTracksRequestSchema.safeParse(input).success).toBe(true);
    expect(
      PublishTracksRequestSchema.safeParse({
        ...input,
        tracks: [input.tracks[0], { ...input.tracks[1], mid: "0" }],
      }).success,
    ).toBe(false);
    expect(
      PublishTracksRequestSchema.safeParse({
        ...input,
        tracks: [input.tracks[0], { ...input.tracks[1], trackName: "audio" }],
      }).success,
    ).toBe(false);
  });
});
