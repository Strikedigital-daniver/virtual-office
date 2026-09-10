import { describe, expect, it } from "vitest";

import {
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_MIN,
  cameraFitsWholeMap,
  clampWalkTarget,
  minZoomToFitMap,
  nextCameraZoom,
  walkVelocityToward,
} from "@/lib/game/camera-controls";

describe("office camera and click-to-walk", () => {
  it("zooms in and out within clamped bounds", () => {
    expect(nextCameraZoom(1, -120)).toBeGreaterThan(1);
    expect(nextCameraZoom(1, 120)).toBeLessThan(1);
    expect(nextCameraZoom(CAMERA_ZOOM_MAX, -120)).toBe(CAMERA_ZOOM_MAX);
    expect(nextCameraZoom(CAMERA_ZOOM_MIN, 120)).toBe(CAMERA_ZOOM_MIN);
  });

  it("computes a zoom floor that can show the whole map", () => {
    expect(minZoomToFitMap(800, 600, 2800, 1800)).toBeLessThan(0.5);
    expect(cameraFitsWholeMap(800, 600, 0.25, 2800, 1800)).toBe(true);
  });

  it("clamps a walk target inside the map", () => {
    expect(clampWalkTarget(-40, 9999, 320, 240)).toEqual({ x: 1, y: 239 });
  });

  it("stops walking when the avatar reaches the target", () => {
    expect(walkVelocityToward(10, 10, 12, 10, 160, 8).arrived).toBe(true);
    const moving = walkVelocityToward(10, 10, 100, 10, 160, 8);
    expect(moving.arrived).toBe(false);
    expect(moving.vx).toBeGreaterThan(0);
    expect(moving.vy).toBe(0);
  });
});
