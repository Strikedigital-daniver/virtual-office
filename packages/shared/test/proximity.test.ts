import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  decideProximitySubscription,
  distanceBetween,
  effectiveAudioGain,
  effectiveWorldVideoOpacity,
  getProximityFactor,
  proximityZone,
} from "../src/proximity";

describe("getProximityFactor", () => {
  const band = DEFAULT_PROXIMITY_MEDIA_CONFIG.audio;

  it("returns 1 at or inside full radius", () => {
    expect(getProximityFactor(0, band)).toBe(1);
    expect(getProximityFactor(band.fullRadius, band)).toBe(1);
  });

  it("returns 0 beyond outer radius", () => {
    expect(getProximityFactor(band.outerRadius + 1, band)).toBe(0);
    expect(getProximityFactor(band.outerRadius + 100, band)).toBe(0);
  });

  it("is a hard cutoff for audio: no partial gain between full and outer", () => {
    // Audio intentionally has no fade band (fullRadius === outerRadius):
    // it's either fully audible or fully silent, never a fractional gain.
    expect(band.fullRadius).toBe(band.outerRadius);
    expect(getProximityFactor(band.fullRadius - 1, band)).toBe(1);
    expect(getProximityFactor(band.fullRadius, band)).toBe(1);
    expect(getProximityFactor(band.fullRadius + 1, band)).toBe(0);
  });
});

describe("proximityZone", () => {
  const band = DEFAULT_PROXIMITY_MEDIA_CONFIG.video;

  it("classifies full, fade, and out zones", () => {
    expect(proximityZone(0, band)).toBe("FULL");
    expect(proximityZone(band.fullRadius + 1, band)).toBe("FADE");
    expect(proximityZone(band.outerRadius, band)).toBe("OUT_OF_RANGE");
  });
});

describe("decideProximitySubscription", () => {
  const sub = DEFAULT_PROXIMITY_MEDIA_CONFIG.subscription;

  it("subscribes when entering subscribe radius", () => {
    const decision = decideProximitySubscription(
      {
        distance: sub.subscribeRadius - 1,
        nowMs: 1_000,
        wasSubscribed: false,
        subscribedSinceMs: null,
        pendingUnsubscribeAtMs: null,
      },
      sub,
    );
    expect(decision.shouldSubscribe).toBe(true);
  });

  it("does not subscribe when outside subscribe radius", () => {
    const decision = decideProximitySubscription(
      {
        distance: sub.subscribeRadius + 50,
        nowMs: 1_000,
        wasSubscribed: false,
        subscribedSinceMs: null,
        pendingUnsubscribeAtMs: null,
      },
      sub,
    );
    expect(decision.shouldSubscribe).toBe(false);
  });

  it("keeps subscription between subscribe and unsubscribe radii", () => {
    const decision = decideProximitySubscription(
      {
        distance: sub.subscribeRadius + 8,
        nowMs: 5_000,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: null,
      },
      sub,
    );
    expect(decision.shouldSubscribe).toBe(true);
  });

  it("unsubscribes after outer radius and delay", () => {
    const entered = decideProximitySubscription(
      {
        distance: sub.unsubscribeRadius + 10,
        nowMs: 10_000,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: null,
      },
      sub,
    );
    expect(entered.shouldSubscribe).toBe(true);
    expect(entered.pendingUnsubscribeAtMs).toBe(
      10_000 + sub.unsubscribeDelayMs,
    );

    const exited = decideProximitySubscription(
      {
        distance: sub.unsubscribeRadius + 10,
        nowMs: entered.pendingUnsubscribeAtMs! + 1,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: entered.pendingUnsubscribeAtMs,
      },
      sub,
    );
    expect(exited.shouldSubscribe).toBe(false);
  });

  it("cancels pending unsubscribe when moving back inside", () => {
    const decision = decideProximitySubscription(
      {
        distance: sub.subscribeRadius,
        nowMs: 11_000,
        wasSubscribed: true,
        subscribedSinceMs: 1_000,
        pendingUnsubscribeAtMs: 12_000,
      },
      sub,
    );
    expect(decision.shouldSubscribe).toBe(true);
    expect(decision.pendingUnsubscribeAtMs).toBeNull();
  });
});

describe("effective media gates", () => {
  it("respects mute and camera-off", () => {
    expect(
      effectiveAudioGain({
        remoteMicPublished: false,
        subscribed: true,
        audioFactor: 1,
      }),
    ).toBe(0);
    expect(
      effectiveWorldVideoOpacity({
        remoteCameraPublished: false,
        subscribed: true,
        videoFactor: 1,
      }),
    ).toBe(0);
  });

  it("proximity never overrides mute by requiring published track", () => {
    expect(
      effectiveAudioGain({
        remoteMicPublished: false,
        subscribed: true,
        audioFactor: 0.8,
      }),
    ).toBe(0);
  });
});

describe("distanceBetween", () => {
  it("computes euclidean distance", () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
