import { describe, expect, it } from "vitest";

import {
  AVATAR_CATALOG,
  AVATAR_COLLISION,
  AVATAR_FEET_LOCAL,
  AVATAR_SPRITE_HEIGHT,
  AVATAR_SPRITE_WIDTH,
  DEFAULT_AVATAR_APPEARANCE,
  AvatarAppearanceSchema,
  catalogIdsAreUnique,
  ClientEventSchema,
  composeAvatarRgba,
  normalizeAvatarAppearance,
  parseAvatarAppearance,
  randomAvatarAppearance,
  avatarDepthFromFeetY,
  avatarPoseForState,
} from "../src/index";

describe("Sprint 7.2 avatar appearance model", () => {
  it("A: default appearance is valid", () => {
    expect(
      AvatarAppearanceSchema.parse(DEFAULT_AVATAR_APPEARANCE).version,
    ).toBe(1);
    expect(parseAvatarAppearance(DEFAULT_AVATAR_APPEARANCE)).toEqual(
      DEFAULT_AVATAR_APPEARANCE,
    );
  });

  it("B: a full valid appearance parses", () => {
    const value = randomAvatarAppearance(42);
    expect(parseAvatarAppearance(value)).toEqual(value);
  });

  it("C: invalid catalog IDs are rejected or fall back", () => {
    expect(
      parseAvatarAppearance({
        ...DEFAULT_AVATAR_APPEARANCE,
        hairStyleId: "not-in-catalog",
      }),
    ).toBeNull();
    expect(
      normalizeAvatarAppearance({
        ...DEFAULT_AVATAR_APPEARANCE,
        topId: "unknown-shirt",
      }).topId,
    ).toBe(DEFAULT_AVATAR_APPEARANCE.topId);
  });

  it("D: unknown appearance version falls back safely", () => {
    expect(
      normalizeAvatarAppearance({
        ...DEFAULT_AVATAR_APPEARANCE,
        version: 99,
      }),
    ).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });

  it("E: arbitrary URLs/scripts cannot enter appearance config", () => {
    expect(
      parseAvatarAppearance({
        ...DEFAULT_AVATAR_APPEARANCE,
        hairStyleId: "https://evil.example/x.png",
      }),
    ).toBeNull();
    expect(
      normalizeAvatarAppearance({
        version: 1,
        bodyBaseId: "<script>alert(1)</script>",
      }),
    ).toEqual(DEFAULT_AVATAR_APPEARANCE);
  });

  it("F: catalog IDs are unique", () => {
    expect(catalogIdsAreUnique()).toBe(true);
  });

  it("G: catalog contains the required minimum categories", () => {
    expect(AVATAR_CATALOG.skinTones.length).toBeGreaterThanOrEqual(4);
    expect(AVATAR_CATALOG.faces.length).toBeGreaterThanOrEqual(3);
    expect(AVATAR_CATALOG.eyes.length).toBeGreaterThanOrEqual(3);
    expect(AVATAR_CATALOG.mouths.length).toBeGreaterThanOrEqual(3);
    expect(AVATAR_CATALOG.hairStyles.length).toBeGreaterThanOrEqual(5);
    expect(AVATAR_CATALOG.hairColors.length).toBeGreaterThanOrEqual(5);
    expect(AVATAR_CATALOG.tops.length).toBeGreaterThanOrEqual(5);
    expect(AVATAR_CATALOG.bottoms.length).toBeGreaterThanOrEqual(4);
    expect(AVATAR_CATALOG.footwear.length).toBeGreaterThanOrEqual(3);
    expect(AVATAR_CATALOG.headAccessories.length).toBeGreaterThanOrEqual(4);
    expect(AVATAR_CATALOG.faceAccessories.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Sprint 7.2 avatar render contract", () => {
  it("AB/AC: idle and walk frames exist for every direction", () => {
    for (const direction of ["up", "down", "left", "right"] as const) {
      const idle = composeAvatarRgba(
        DEFAULT_AVATAR_APPEARANCE,
        direction,
        "idle",
        0,
      );
      const walk = composeAvatarRgba(
        DEFAULT_AVATAR_APPEARANCE,
        direction,
        "walk",
        1,
      );
      expect(idle.length).toBe(AVATAR_SPRITE_WIDTH * AVATAR_SPRITE_HEIGHT * 4);
      expect(walk.length).toBe(idle.length);
      expect(walk.some((value, index) => value !== idle[index])).toBe(true);
    }
  });

  it("AD: the same pose/direction/frame is a stable layered composition", () => {
    const a = composeAvatarRgba(DEFAULT_AVATAR_APPEARANCE, "left", "walk", 1);
    const b = composeAvatarRgba(DEFAULT_AVATAR_APPEARANCE, "left", "walk", 1);
    expect([...a]).toEqual([...b]);
  });

  it("AG: depth uses feet / world Y, not sprite height", () => {
    expect(avatarDepthFromFeetY(128.4)).toBe(128);
    expect(avatarDepthFromFeetY(128.4)).not.toBe(AVATAR_SPRITE_HEIGHT);
  });

  it("AE/AF: feet anchor and collision stay constant across clothing", () => {
    const a = composeAvatarRgba(DEFAULT_AVATAR_APPEARANCE, "down", "idle", 0);
    const b = composeAvatarRgba(
      {
        ...DEFAULT_AVATAR_APPEARANCE,
        topId: "top-hoodie",
        hairStyleId: "hair-long",
      },
      "down",
      "idle",
      0,
    );
    const feetIndex =
      (AVATAR_FEET_LOCAL.y * AVATAR_SPRITE_WIDTH + AVATAR_FEET_LOCAL.x) * 4;
    expect(a[feetIndex + 3]).toBeGreaterThan(0);
    expect(b[feetIndex + 3]).toBeGreaterThan(0);
    expect(AVATAR_COLLISION).toEqual({ width: 16, height: 10 });
  });

  it("AH: desk id maps to seated pose", () => {
    expect(avatarPoseForState({ moving: true, currentDeskId: "desk-1" })).toBe(
      "seated",
    );
    expect(avatarPoseForState({ moving: true, currentDeskId: null })).toBe(
      "walk",
    );
  });
});

describe("Sprint 7.2 avatar protocol", () => {
  it("Z: player.move does not carry appearance", () => {
    const parsed = ClientEventSchema.parse({
      type: "player.move",
      seq: 1,
      x: 10,
      y: 20,
      direction: "down",
      moving: true,
      clientTime: 1,
      appearance: DEFAULT_AVATAR_APPEARANCE,
    });
    expect(parsed.type).toBe("player.move");
    expect("appearance" in parsed).toBe(false);
  });
});
