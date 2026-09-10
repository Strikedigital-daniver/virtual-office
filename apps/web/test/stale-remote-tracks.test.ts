import { describe, expect, it } from "vitest";

import {
  catalogTrackKeys,
  findStaleRemoteRefs,
} from "@/lib/media/stale-remote-tracks";

const USER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("findStaleRemoteRefs", () => {
  it("flags a bound remote when the catalog no longer lists that track", () => {
    const stale = {
      ownerUserId: USER,
      sessionId: "old-session",
      trackName: "video-old",
      kind: "video" as const,
    };
    expect(
      findStaleRemoteRefs(
        [stale],
        [
          {
            ownerUserId: USER,
            sessionId: "new-session",
            trackName: "video-new",
            mid: "0",
            kind: "video",
          },
        ],
      ),
    ).toEqual([stale]);
  });

  it("keeps bindings that still match the catalog", () => {
    const current = {
      ownerUserId: USER,
      sessionId: "session-a",
      trackName: "video-a",
      kind: "video" as const,
    };
    const catalog = [
      {
        ownerUserId: USER,
        sessionId: "session-a",
        trackName: "video-a",
        mid: "0",
        kind: "video" as const,
      },
    ];
    expect(findStaleRemoteRefs([current], catalog)).toEqual([]);
    expect(catalogTrackKeys(catalog)).toEqual(new Set(["session-a:video-a"]));
  });
});
