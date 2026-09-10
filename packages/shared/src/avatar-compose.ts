import type { Direction } from "./protocol";
import {
  AVATAR_FEET_LOCAL,
  AVATAR_SPRITE_HEIGHT,
  AVATAR_SPRITE_WIDTH,
  type AvatarAppearance,
  type AvatarPose,
} from "./avatar-appearance";

type Rgba = [number, number, number, number];

const SKIN: Record<string, Rgba> = {
  "skin-sand": [242, 214, 189, 255],
  "skin-honey": [224, 176, 132, 255],
  "skin-clay": [198, 134, 96, 255],
  "skin-umber": [150, 92, 64, 255],
  "skin-bronze": [112, 68, 48, 255],
  "skin-deep": [72, 44, 32, 255],
};

const HAIR: Record<string, Rgba> = {
  "hair-ink": [28, 24, 32, 255],
  "hair-soil": [74, 48, 32, 255],
  "hair-copper": [164, 72, 36, 255],
  "hair-sun": [214, 176, 72, 255],
  "hair-fog": [164, 164, 172, 255],
  "hair-moss": [64, 132, 72, 255],
  "hair-violet": [112, 72, 168, 255],
  "hair-snow": [236, 236, 240, 255],
};

const CLOTH: Record<string, Rgba> = {
  "top-tee": [72, 168, 132, 255],
  "top-tank": [216, 96, 88, 255],
  "top-hoodie": [64, 92, 168, 255],
  "top-jacket": [48, 52, 64, 255],
  "top-overshirt": [196, 164, 88, 255],
  "top-knit": [168, 88, 128, 255],
  "top-vest": [88, 120, 72, 255],
  "top-wrap": [176, 120, 72, 255],
  "bottom-jeans": [56, 84, 140, 255],
  "bottom-slim": [40, 48, 64, 255],
  "bottom-wide": [92, 108, 148, 255],
  "bottom-short": [72, 88, 64, 255],
  "bottom-skirt": [148, 72, 112, 255],
  "bottom-cargo": [96, 84, 56, 255],
  "feet-sneaker": [232, 232, 236, 255],
  "feet-boot": [64, 44, 32, 255],
  "feet-sandal": [168, 124, 72, 255],
  "feet-sock": [248, 248, 252, 255],
};

function hex(color: Rgba): Rgba {
  return color;
}

export function composeAvatarRgba(
  appearance: AvatarAppearance,
  direction: Direction,
  pose: AvatarPose,
  walkFrame = 0,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(
    AVATAR_SPRITE_WIDTH * AVATAR_SPRITE_HEIGHT * 4,
  );
  const put = (x: number, y: number, color: Rgba) => {
    if (x < 0 || y < 0 || x >= AVATAR_SPRITE_WIDTH || y >= AVATAR_SPRITE_HEIGHT)
      return;
    const i = (y * AVATAR_SPRITE_WIDTH + x) * 4;
    pixels[i] = color[0];
    pixels[i + 1] = color[1];
    pixels[i + 2] = color[2];
    pixels[i + 3] = color[3];
  };
  const rect = (x: number, y: number, w: number, h: number, color: Rgba) => {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) put(x + dx, y + dy, color);
    }
  };

  const skin = SKIN[appearance.skinToneId] ?? SKIN["skin-honey"]!;
  const hair = HAIR[appearance.hairColorId] ?? HAIR["hair-soil"]!;
  const top = CLOTH[appearance.topId] ?? CLOTH["top-tee"]!;
  const bottom = CLOTH[appearance.bottomId] ?? CLOTH["bottom-jeans"]!;
  const feet = CLOTH[appearance.footwearId] ?? CLOTH["feet-sneaker"]!;
  const outline: Rgba = [18, 16, 22, 255];
  const eyeWhite: Rgba = [248, 248, 252, 255];
  const iris: Rgba = [32, 36, 48, 255];
  const mouth: Rgba = [120, 48, 56, 255];
  const seated = pose === "seated";
  const walk = pose === "walk" ? (walkFrame % 2 === 0 ? -1 : 1) : 0;
  const tall = appearance.bodyBaseId === "body-tall" ? 1 : 0;
  const compact = appearance.bodyBaseId === "body-compact" ? 1 : 0;
  const bodyTop = 14 - tall + compact;
  const hip = seated ? 26 : 24 + compact;
  const side = direction === "left" || direction === "right";
  const back = direction === "up";
  const cx = 12;

  rect(cx - 5, bodyTop + 1, 10, seated ? 10 : 11, top);
  rect(cx - 6, bodyTop, 12, 2, outline);
  if (appearance.topId === "top-hoodie" || appearance.topId === "top-jacket") {
    rect(cx - 6, bodyTop + 2, 2, 8, top);
    rect(cx + 4, bodyTop + 2, 2, 8, top);
  }
  if (appearance.topId === "top-tank") {
    rect(cx - 5, bodyTop + 1, 2, 3, skin);
    rect(cx + 3, bodyTop + 1, 2, 3, skin);
  }

  const legY = seated ? hip + 1 : hip;
  const stride = seated ? 0 : walk;
  rect(cx - 4 + (side && direction === "left" ? 1 : 0), legY, 3, 7, bottom);
  rect(cx + 1 + (side && direction === "right" ? -1 : 0), legY, 3, 7, bottom);
  if (appearance.bottomId === "bottom-skirt") {
    rect(cx - 5, hip - 1, 10, 5, bottom);
  }
  if (appearance.bottomId === "bottom-short") {
    rect(cx - 4, legY + 4, 3, 3, skin);
    rect(cx + 1, legY + 4, 3, 3, skin);
  }
  if (!seated) {
    rect(cx - 4 + stride, 32, 3, 3, feet);
    rect(cx + 1 - stride, 32, 3, 3, feet);
  } else {
    rect(cx - 5, 33, 4, 2, feet);
    rect(cx + 1, 33, 4, 2, feet);
  }

  const armY = bodyTop + 3 + (walk ? walk : 0);
  if (!seated) {
    rect(cx - 7, armY, 2, 7, skin);
    rect(cx + 5, armY, 2, 7, skin);
  } else {
    rect(cx - 7, bodyTop + 6, 3, 2, skin);
    rect(cx + 4, bodyTop + 6, 3, 2, skin);
  }

  const faceW =
    appearance.faceId === "face-wide"
      ? 12
      : appearance.faceId === "face-angular"
        ? 10
        : 11;
  const faceX = cx - Math.floor(faceW / 2);
  const faceY = 6;
  const faceH = appearance.faceId === "face-oval" ? 9 : 8;
  rect(faceX, faceY, faceW, faceH, skin);
  rect(faceX, faceY, faceW, 1, outline);
  rect(faceX, faceY + faceH - 1, faceW, 1, outline);

  if (!back) {
    const eyeY = appearance.eyesId === "eyes-sleepy" ? faceY + 3 : faceY + 2;
    const eyeH = appearance.eyesId === "eyes-wide" ? 3 : 2;
    rect(faceX + 2, eyeY, 3, eyeH, eyeWhite);
    rect(faceX + faceW - 5, eyeY, 3, eyeH, eyeWhite);
    const irisX = appearance.eyesId === "eyes-bright" ? 1 : 0;
    put(faceX + 3 + irisX, eyeY + (eyeH > 2 ? 1 : 0), iris);
    put(faceX + faceW - 4 + irisX, eyeY + (eyeH > 2 ? 1 : 0), iris);
    if (appearance.eyebrowsId !== "brows-none") {
      const browY = eyeY - 1;
      const lift = appearance.eyebrowsId === "brows-arch" ? -1 : 0;
      rect(faceX + 2, browY + lift, 3, 1, hair);
      rect(faceX + faceW - 5, browY, 3, 1, hair);
    }
    const mouthY = faceY + faceH - 3;
    if (appearance.mouthId === "mouth-open") {
      rect(cx - 1, mouthY, 3, 2, mouth);
    } else if (appearance.mouthId === "mouth-grin") {
      rect(cx - 2, mouthY, 5, 1, mouth);
    } else if (appearance.mouthId === "mouth-smirk") {
      rect(cx, mouthY, 3, 1, mouth);
    } else if (appearance.mouthId === "mouth-neutral") {
      rect(cx - 1, mouthY, 3, 1, outline);
    } else {
      rect(cx - 1, mouthY, 3, 1, mouth);
      put(cx - 1, mouthY, skin);
      put(cx + 1, mouthY, skin);
    }
    if (appearance.facialHairId === "facial-stubble") {
      rect(faceX + 2, mouthY + 1, faceW - 4, 1, [90, 60, 48, 180]);
    } else if (appearance.facialHairId === "facial-mustache") {
      rect(cx - 2, mouthY - 1, 5, 1, hair);
    } else if (appearance.facialHairId === "facial-beard") {
      rect(faceX + 2, mouthY + 1, faceW - 4, 2, hair);
    }
    if (appearance.faceAccessoryId === "faceacc-round") {
      rect(faceX + 1, eyeY, 4, 3, outline);
      rect(faceX + faceW - 5, eyeY, 4, 3, outline);
    } else if (appearance.faceAccessoryId === "faceacc-rect") {
      rect(faceX + 1, eyeY, 4, 2, outline);
      rect(faceX + faceW - 5, eyeY, 4, 2, outline);
    } else if (appearance.faceAccessoryId === "faceacc-shade") {
      rect(faceX + 1, eyeY, faceW - 2, 2, [24, 24, 28, 255]);
    } else if (appearance.faceAccessoryId === "faceacc-mark") {
      put(faceX + faceW - 3, mouthY, [180, 64, 72, 255]);
    }
  }

  const hairY = 3;
  if (appearance.hairStyleId !== "hair-none") {
    rect(faceX - 1, hairY + 1, faceW + 2, 3, hair);
    if (appearance.hairStyleId === "hair-long" && !seated) {
      rect(faceX - 1, 10, 2, 10, hair);
      rect(faceX + faceW - 1, 10, 2, 10, hair);
    }
    if (appearance.hairStyleId === "hair-bun") {
      rect(cx - 2, 1, 4, 3, hair);
    }
    if (appearance.hairStyleId === "hair-halo") {
      rect(faceX - 2, hairY, faceW + 4, 2, hair);
    }
    if (appearance.hairStyleId === "hair-wave") {
      put(faceX - 1, hairY + 2, hair);
      put(faceX + faceW, hairY + 3, hair);
    }
    if (appearance.hairStyleId === "hair-fringe" && !back) {
      rect(faceX, faceY, faceW, 2, hair);
    }
  }

  if (appearance.headAccessoryId === "head-cap") {
    rect(faceX - 1, 2, faceW + 2, 3, [48, 140, 96, 255]);
  } else if (appearance.headAccessoryId === "head-beanie") {
    rect(faceX, 1, faceW, 4, [88, 48, 128, 255]);
  } else if (appearance.headAccessoryId === "head-band") {
    rect(faceX, 5, faceW, 1, [220, 80, 96, 255]);
  } else if (appearance.headAccessoryId === "head-sprout") {
    put(cx, 1, [80, 180, 88, 255]);
    put(cx, 2, [80, 180, 88, 255]);
  } else if (appearance.headAccessoryId === "head-antenna") {
    rect(cx, 0, 1, 4, [180, 220, 120, 255]);
    put(cx, 0, [220, 255, 140, 255]);
  }

  if (appearance.accessoryId === "acc-bag" && direction !== "up") {
    rect(cx + 6, hip - 2, 3, 5, [96, 64, 40, 255]);
  } else if (appearance.accessoryId === "acc-scarf") {
    rect(cx - 4, bodyTop, 8, 2, [196, 64, 72, 255]);
  } else if (appearance.accessoryId === "acc-pin") {
    put(cx + 3, bodyTop + 3, [240, 200, 72, 255]);
  }

  put(AVATAR_FEET_LOCAL.x, AVATAR_FEET_LOCAL.y, hex(feet));
  return pixels;
}

export function composeAvatarPortraitRgba(
  appearance: AvatarAppearance,
): Uint8ClampedArray {
  const full = composeAvatarRgba(appearance, "down", "idle", 0);
  const width = AVATAR_SPRITE_WIDTH;
  const height = 16;
  const portrait = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((y + 1) * AVATAR_SPRITE_WIDTH + x) * 4;
      const dst = (y * width + x) * 4;
      portrait[dst] = full[src]!;
      portrait[dst + 1] = full[src + 1]!;
      portrait[dst + 2] = full[src + 2]!;
      portrait[dst + 3] = full[src + 3]!;
    }
  }
  return portrait;
}
