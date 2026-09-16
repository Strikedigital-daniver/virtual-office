import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudflareMediaProvider } from "@/lib/media/cloudflare-media-provider";
import {
  MEDIA_REQUEST_TIMEOUT_MS,
  type RemoteTrackRef,
} from "@/lib/media/media-provider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeTrack extends EventTarget {
  readonly kind = "audio";
  enabled = true;
  readyState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
}

function asTrack(track: FakeTrack) {
  return track as unknown as MediaStreamTrack;
}

class FakePeer extends EventTarget {
  static instances: FakePeer[] = [];
  connectionState = "connected";
  iceConnectionState = "connected";
  signalingState = "stable";
  localDescription: RTCSessionDescriptionInit | null = null;
  private transceiverCount = 0;
  constructor() {
    super();
    FakePeer.instances.push(this);
  }
  close = vi.fn(() => {
    this.connectionState = "closed";
  });
  addTransceiver = (track: MediaStreamTrack) => {
    const result = {
      mid: String(this.transceiverCount++),
      sender: {
        track,
        replaceTrack: vi.fn(async () => {}),
        getParameters: () => ({ encodings: [{}] }),
        setParameters: async () => {},
      },
      stop: vi.fn(),
    };
    return result;
  };
  createOffer = async () => ({ type: "offer", sdp: "offer" });
  createAnswer = async () => ({ type: "answer", sdp: "answer" });
  setLocalDescription = async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description;
    this.signalingState =
      description.type === "offer" ? "have-local-offer" : "stable";
  };
  setRemoteDescription = async (description: RTCSessionDescriptionInit) => {
    this.signalingState =
      description.type === "offer" ? "have-remote-offer" : "stable";
  };
  receive(mid: string, track = new FakeTrack()) {
    const transceiver = { mid, stop: vi.fn() };
    this.dispatchEvent(
      Object.assign(new Event("track"), { track, transceiver }),
    );
    return { track, transceiver };
  }
}

const ref: RemoteTrackRef = {
  ownerUserId: "remote-user",
  sessionId: "remote-session",
  trackName: "remote-audio",
  kind: "audio",
};

function setup() {
  const callbacks = {
    onRemoteTrack: vi.fn(),
    onRemoteTrackClosed: vi.fn(),
    onState: vi.fn(),
    onLocalTrackClosed: vi.fn(),
  };
  let session = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    void options;
    if (url.endsWith("/session"))
      return Response.json({ sessionId: `session-${++session}` });
    if (url.endsWith("/tracks/publish")) {
      return Response.json({
        sessionDescription: { type: "answer", sdp: "answer" },
      });
    }
    if (url.endsWith("/tracks/subscribe")) {
      return Response.json({
        tracks: [{ mid: "remote-mid", trackName: ref.trackName }],
        sessionDescription: { type: "offer", sdp: "offer" },
      });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  const provider = new CloudflareMediaProvider(
    async () => ({
      ticket: "test-ticket",
      mediaBaseUrl: "https://test.invalid/media",
    }),
    "self-user",
    callbacks,
  );
  return { provider, callbacks, fetchMock };
}

beforeEach(() => {
  FakePeer.instances = [];
  vi.stubGlobal("RTCPeerConnection", FakePeer);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SFU provider lifecycle", () => {
  it("aborts stalled session requests and closes their peers at the HTTP deadline", async () => {
    const deadline = new AbortController();
    const timeouts = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    const { provider, fetchMock } = setup();
    fetchMock.mockImplementation(
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(options!.signal!.reason),
            { once: true },
          );
        }),
    );
    const connecting = provider.connect();
    const rejected = expect(connecting).rejects.toThrow("request timed out");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(timeouts).toHaveBeenCalledWith(MEDIA_REQUEST_TIMEOUT_MS);
    deadline.abort(new DOMException("request timed out", "TimeoutError"));
    await rejected;
    expect(
      FakePeer.instances.every((peer) => peer.connectionState === "closed"),
    ).toBe(true);
  });
  it("rolls back a failed catalog resync so later negotiation can proceed", async () => {
    const { provider, fetchMock } = setup();
    await provider.connect();
    await provider.publish("audio", asTrack(new FakeTrack()));
    await Promise.resolve();
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "temporary failure" }, { status: 503 }),
    );
    await expect(provider.reregister("audio")).rejects.toThrow(
      "temporary failure",
    );
    expect(FakePeer.instances[0]!.signalingState).toBe("stable");
    await expect(provider.reregister("audio")).resolves.toBeUndefined();
    await provider.disconnect();
  });
  it("releases captured devices and updates controls if transport repair fails", async () => {
    const { provider, callbacks, fetchMock } = setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await provider.connect();
    const track = new FakeTrack();
    await provider.publish("audio", asTrack(track));
    await Promise.resolve();
    FakePeer.instances[0]!.connectionState = "failed";
    FakePeer.instances[0]!.iceConnectionState = "failed";
    now.mockReturnValue(30_000);
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "unavailable" }, { status: 503 }),
    );
    await expect(provider.repairSendTransportIfNeeded()).rejects.toThrow(
      "unavailable",
    );
    expect(track.readyState).toBe("ended");
    expect(track.enabled).toBe(false);
    expect(provider.publishedKinds()).toEqual([]);
    expect(callbacks.onLocalTrackClosed).toHaveBeenCalledWith("audio");
    const replacement = new FakeTrack();
    await expect(
      provider.publish("audio", asTrack(replacement)),
    ).resolves.toMatchObject({ kind: "audio" });
    await provider.disconnect();
  });

  it("updates controls and closes the publication when hardware ends a capture", async () => {
    const { provider, callbacks } = setup();
    await provider.connect();
    const track = new FakeTrack();
    await provider.publish("audio", asTrack(track));
    track.readyState = "ended";
    track.dispatchEvent(new Event("ended"));
    expect(provider.publishedKinds()).toEqual([]);
    expect(callbacks.onLocalTrackClosed).toHaveBeenCalledWith("audio");
    await provider.disconnect();
  });

  it("closes both peers when only one session opens successfully", async () => {
    const { provider, fetchMock } = setup();
    fetchMock
      .mockResolvedValueOnce(Response.json({ sessionId: "ok" }))
      .mockResolvedValueOnce(
        Response.json({ error: "unavailable" }, { status: 503 }),
      );
    await expect(provider.connect()).rejects.toThrow("unavailable");
    expect(FakePeer.instances).toHaveLength(2);
    expect(
      FakePeer.instances.every((peer) => peer.connectionState === "closed"),
    ).toBe(true);
    expect(provider.getSendPeerConnection()).toBeNull();
    expect(provider.getRecvPeerConnection()).toBeNull();
  });

  it("cannot resurrect peers when a connect request completes after leaving", async () => {
    const { provider, fetchMock } = setup();
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const connecting = provider.connect();
    const rejected = expect(connecting).rejects.toThrow("cerrada");
    await Promise.resolve();
    await provider.disconnect();
    pending.resolve(Response.json({ sessionId: "late" }));
    await rejected;
    expect(provider.getSendPeerConnection()).toBeNull();
    expect(provider.getRecvPeerConnection()).toBeNull();
    expect(
      FakePeer.instances.every((peer) => peer.connectionState === "closed"),
    ).toBe(true);
  });

  it("stops a capture immediately when leaving during a pending publish", async () => {
    const { provider, fetchMock } = setup();
    await provider.connect();
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const track = new FakeTrack();
    const publishing = provider.publish("audio", asTrack(track));
    const rejected = expect(publishing).rejects.toThrow("cerrada");
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url.endsWith("/tracks/publish")),
      ).toBe(true),
    );
    await provider.disconnect();
    expect(track.readyState).toBe("ended");
    expect(track.enabled).toBe(false);
    pending.resolve(
      Response.json({ sessionDescription: { type: "answer", sdp: "answer" } }),
    );
    await rejected;
    expect(provider.publishedKinds()).toEqual([]);
  });

  it("revokes local playback before a slow close request finishes", async () => {
    const { provider, callbacks, fetchMock } = setup();
    await provider.connect();
    await provider.subscribe(ref);
    const remote = FakePeer.instances[1]!.receive("remote-mid");
    expect(callbacks.onRemoteTrack).toHaveBeenCalledOnce();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const closing = provider.unsubscribe(ref);
    expect(remote.track.readyState).toBe("ended");
    expect(callbacks.onRemoteTrackClosed).toHaveBeenCalledWith(ref);
    expect(provider.isRemoteBound(ref)).toBe(false);
    pending.resolve(Response.json({}));
    await closing;
    await provider.disconnect();
  });

  it("closes pending MIDs and ignores late tracks after revocation", async () => {
    const { provider, callbacks, fetchMock } = setup();
    await provider.connect();
    await provider.subscribe(ref);
    expect(provider.isRemoteBound(ref)).toBe(true);
    await provider.unsubscribe(ref);
    expect(provider.isRemoteBound(ref)).toBe(false);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          url.endsWith("/tracks/close") &&
          options?.body ===
            JSON.stringify({
              sessionId: "session-2",
              tracks: [{ mid: "remote-mid" }],
              force: true,
            }),
      ),
    ).toBe(true);
    const late = FakePeer.instances[1]!.receive("remote-mid");
    expect(late.track.readyState).toBe("ended");
    expect(callbacks.onRemoteTrack).not.toHaveBeenCalled();
    await provider.disconnect();
  });

  it("cancels a queued subscribe when proximity is revoked before negotiation starts", async () => {
    const { provider, fetchMock } = setup();
    await provider.connect();
    const subscribing = provider.subscribe(ref);
    const revoking = provider.unsubscribe(ref);
    await Promise.all([subscribing, revoking]);
    expect(
      fetchMock.mock.calls.some(([url]) => url.endsWith("/tracks/subscribe")),
    ).toBe(false);
    expect(provider.isRemoteBound(ref)).toBe(false);
    await provider.disconnect();
  });

  it("never labels an unknown MID as a different pending participant", async () => {
    const { provider, callbacks } = setup();
    await provider.connect();
    await provider.subscribe(ref);
    const unknown = FakePeer.instances[1]!.receive("old-mid");
    expect(callbacks.onRemoteTrack).not.toHaveBeenCalled();
    expect(unknown.track.readyState).toBe("ended");
    FakePeer.instances[1]!.receive("remote-mid");
    expect(callbacks.onRemoteTrack).toHaveBeenCalledWith(
      ref,
      expect.any(FakeTrack),
    );
    await provider.disconnect();
  });
});
