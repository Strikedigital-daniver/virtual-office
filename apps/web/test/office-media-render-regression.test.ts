// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpatialAudioMixer } from "@/lib/proximity/spatial-audio-mixer";
import { useOfficeMedia } from "@/lib/media/use-office-media";

const mediaMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  publish: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/media/local-media", () => ({
  captureLocalTrack: mediaMocks.capture,
  classifyMediaDeviceError: () => "No se pudo activar el dispositivo.",
}));

vi.mock("@/lib/spatial-debug/enabled", () => ({
  spatialDebugEnabled: () => false,
}));
vi.mock("@/lib/media/cloudflare-media-provider", () => ({
  CloudflareMediaProvider: class {
    connect = mediaMocks.connect;
    disconnect = mediaMocks.disconnect;
    publish = mediaMocks.publish;
    publishedKinds = () => [];
    remoteRefs = () => [];
  },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mediaMocks.connect.mockResolvedValue(undefined);
  mediaMocks.disconnect.mockResolvedValue(undefined);
  mediaMocks.publish.mockResolvedValue(undefined);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("retries a transient media connection failure without reconnecting presence", async () => {
  vi.useFakeTimers();
  mediaMocks.connect.mockRejectedValueOnce(new Error("temporary outage"));
  const tracks: [] = [];
  const positions = new Map();
  function Harness() {
    const media = useOfficeMedia({
      officeSlug: "temple",
      availableTracks: tracks,
      nameFor: () => "QA",
      localPosition: null,
      remotePositions: positions,
      presenceConnected: true,
    });
    return createElement("span", null, String(media.ready));
  }
  await act(async () => root.render(createElement(Harness)));
  expect(host.textContent).toBe("false");
  expect(mediaMocks.disconnect).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(host.textContent).toBe("true");
  expect(mediaMocks.connect).toHaveBeenCalledTimes(2);
  expect(mediaMocks.capture).not.toHaveBeenCalled();
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
    let renders = 0;
    function Harness() {
      renders++;
      if (renders > 40)
        throw new Error("media render loop exceeded 40 renders");
      const media = useOfficeMedia({
        officeSlug: "temple",
        availableTracks: tracks,
        nameFor: () => "QA",
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
    expect(mediaMocks.connect).toHaveBeenCalledOnce();
    for (let key = 0; key < 20; key++) {
      await act(async () => latest?.unlockSpatialAudio());
    }
    expect(resets).not.toHaveBeenCalled();
  },
);

it("closes media on presence loss and reconnects with devices off", async () => {
  let latest: ReturnType<typeof useOfficeMedia> | null = null;
  const tracks: [] = [];
  const positions = new Map();
  function Harness({ connected }: { connected: boolean }) {
    latest = useOfficeMedia({
      officeSlug: "temple",
      availableTracks: tracks,
      nameFor: () => "QA",
      localPosition: null,
      remotePositions: positions,
      presenceConnected: connected,
    });
    return createElement("span", null, `${latest.ready}:${latest.micStatus}`);
  }
  await act(async () =>
    root.render(createElement(Harness, { connected: false })),
  );
  expect(mediaMocks.connect).not.toHaveBeenCalled();
  await act(async () =>
    root.render(createElement(Harness, { connected: true })),
  );
  const track = { readyState: "live", stop: vi.fn() };
  mediaMocks.capture.mockResolvedValue(track);
  await act(async () => latest?.toggleMic());
  expect(host.textContent).toBe("true:on");
  await act(async () =>
    root.render(createElement(Harness, { connected: false })),
  );
  expect(mediaMocks.disconnect).toHaveBeenCalledOnce();
  expect(host.textContent).toBe("false:off");
  await act(async () =>
    root.render(createElement(Harness, { connected: true })),
  );
  expect(host.textContent).toBe("true:off");
  expect(mediaMocks.connect).toHaveBeenCalledTimes(2);
  expect(mediaMocks.capture).toHaveBeenCalledOnce();
});

it("stops capture that resolves after presence has been lost without publishing it", async () => {
  let latest: ReturnType<typeof useOfficeMedia> | null = null;
  const tracks: [] = [];
  const positions = new Map();
  function Harness({ connected }: { connected: boolean }) {
    latest = useOfficeMedia({
      officeSlug: "temple",
      availableTracks: tracks,
      nameFor: () => "QA",
      localPosition: null,
      remotePositions: positions,
      presenceConnected: connected,
    });
    return null;
  }
  let resolveCapture!: (track: unknown) => void;
  mediaMocks.capture.mockReturnValue(
    new Promise((resolve) => {
      resolveCapture = resolve;
    }),
  );
  await act(async () =>
    root.render(createElement(Harness, { connected: true })),
  );
  let toggling: Promise<void> | undefined;
  await act(async () => {
    toggling = latest?.toggleMic();
  });
  await act(async () =>
    root.render(createElement(Harness, { connected: false })),
  );
  const track = { readyState: "live", stop: vi.fn() };
  await act(async () => {
    resolveCapture(track);
    await toggling;
  });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(mediaMocks.publish).not.toHaveBeenCalled();
});
