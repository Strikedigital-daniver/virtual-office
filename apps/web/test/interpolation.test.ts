import { describe, expect, it } from "vitest";

import {
  pushSample,
  sampleAt,
  type TimedPosition,
} from "@/lib/game/interpolation";

describe("remote player interpolation", () => {
  it("interpolates linearly between two samples", () => {
    const buffer: TimedPosition[] = [];
    pushSample(buffer, { t: 1000, x: 0, y: 0 });
    pushSample(buffer, { t: 1200, x: 100, y: 50 });
    expect(sampleAt(buffer, 1100)).toEqual({ x: 50, y: 25 });
  });

  it("clamps before the first and after the last sample", () => {
    const buffer: TimedPosition[] = [];
    pushSample(buffer, { t: 1000, x: 10, y: 20 });
    pushSample(buffer, { t: 1100, x: 30, y: 40 });
    expect(sampleAt(buffer, 900)).toEqual({ x: 10, y: 20 });
    expect(sampleAt(buffer, 5000)).toEqual({ x: 30, y: 40 });
    expect(sampleAt([], 1000)).toBeNull();
  });

  it("discards out-of-order samples and trims old history", () => {
    const buffer: TimedPosition[] = [];
    pushSample(buffer, { t: 1000, x: 0, y: 0 });
    pushSample(buffer, { t: 900, x: 99, y: 99 });
    expect(buffer).toHaveLength(1);
    pushSample(buffer, { t: 4000, x: 1, y: 1 });
    pushSample(buffer, { t: 4100, x: 2, y: 2 });
    expect(buffer[0]?.t).toBe(4000);
  });
});
