// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpatialAudioMixer } from "@/lib/proximity/spatial-audio-mixer";
import { useOfficeMedia } from "@/lib/media/use-office-media";

vi.mock("@/lib/spatial-debug/enabled", () => ({
  spatialDebugEnabled: () => false,
}));
vi.mock("@/lib/media/cloudflare-media-provider", () => ({
  CloudflareMediaProvider: class {
    connect = async () => {};
    disconnect = async () => {};
    publishedKinds = () => [];
  },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        userId: "qa",
        accessClass: "OFFICE_COLLABORATOR",
        ticket: "test",
        mediaBaseUrl: "https://example.invalid",
      }),
    })),
  );
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([true, false])(
  "settles with inline callbacks (explicit broadcast ids: %s) and preserves audio graphs on key gestures",
  async (explicitBroadcast) => {
    const resets = vi.spyOn(SpatialAudioMixer.prototype, "resetAttachments");
    let latest: ReturnType<typeof useOfficeMedia> | null = null;
    const broadcastSpeakerIds = new Set<string>();
    const tracks: [] = [];
    const positions = new Map();
    const position = { x: 100, y: 100, zoneId: "zone-office" };
    const nameFor = () => "QA";
    let renders = 0;
    function Harness() {
      renders++;
      if (renders > 40)
        throw new Error("media render loop exceeded 40 renders");
      const media = useOfficeMedia({
        officeSlug: "temple",
        availableTracks: tracks,
        nameFor,
        localPosition: position,
        remotePositions: positions,
        ...(explicitBroadcast ? { broadcastSpeakerIds } : {}),
        onEvictCatalogTrack: () => {},
      });
      latest = media;
      return createElement("span", null, String(media.ready));
    }
    await act(async () => {
      root.render(createElement(Harness));
    });
    expect(host.textContent).toBe("true");
    expect(renders).toBeLessThan(10);
    for (let key = 0; key < 20; key++) {
      await act(async () => latest?.unlockSpatialAudio());
    }
    expect(resets).not.toHaveBeenCalled();
  },
);
