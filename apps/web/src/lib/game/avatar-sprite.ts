import {
  AVATAR_COLLISION,
  AVATAR_SPRITE_HEIGHT,
  AVATAR_SPRITE_WIDTH,
  appearanceFingerprint,
  avatarDepthFromFeetY,
  avatarPoseForState,
  composeAvatarRgba,
  normalizeAvatarAppearance,
  type AvatarAppearance,
  type Direction,
} from "@virtual-office/shared";
import type PhaserNamespace from "phaser";

function textureKey(
  appearance: AvatarAppearance,
  direction: Direction,
  pose: ReturnType<typeof avatarPoseForState>,
  frame: number,
): string {
  return `avo:${appearanceFingerprint(appearance)}:${direction}:${pose}:${frame}`;
}

export function ensureAvatarTexture(
  scene: PhaserNamespace.Scene,
  appearance: AvatarAppearance,
  direction: Direction,
  pose: ReturnType<typeof avatarPoseForState>,
  frame: number,
): string {
  const key = textureKey(appearance, direction, pose, frame);
  if (scene.textures.exists(key)) return key;
  const pixels = composeAvatarRgba(appearance, direction, pose, frame);
  const texture = scene.textures.createCanvas(
    key,
    AVATAR_SPRITE_WIDTH,
    AVATAR_SPRITE_HEIGHT,
  );
  if (!texture) return key;
  const ctx = texture.getContext();
  const image = ctx.createImageData(AVATAR_SPRITE_WIDTH, AVATAR_SPRITE_HEIGHT);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);
  texture.refresh();
  return key;
}

export function createAvatarSprite(
  scene: PhaserNamespace.Scene,
  x: number,
  y: number,
  appearance: AvatarAppearance,
  direction: Direction,
): PhaserNamespace.Physics.Arcade.Sprite {
  const pose = avatarPoseForState({ moving: false });
  const key = ensureAvatarTexture(scene, appearance, direction, pose, 0);
  const sprite = scene.physics.add.sprite(x, y, key);
  sprite.setOrigin(0.5, 1);
  sprite.setDepth(avatarDepthFromFeetY(y));
  sprite.body?.setSize(AVATAR_COLLISION.width, AVATAR_COLLISION.height);
  sprite.body?.setOffset(
    (AVATAR_SPRITE_WIDTH - AVATAR_COLLISION.width) / 2,
    AVATAR_SPRITE_HEIGHT - AVATAR_COLLISION.height,
  );
  sprite.setData("appearance", appearance);
  return sprite;
}

export function syncAvatarSprite(
  scene: PhaserNamespace.Scene,
  sprite: PhaserNamespace.Physics.Arcade.Sprite,
  input: {
    appearance: AvatarAppearance;
    direction: Direction;
    moving: boolean;
    currentDeskId?: string | null | undefined;
    nowMs: number;
  },
): void {
  const appearance = normalizeAvatarAppearance(input.appearance);
  const pose = avatarPoseForState({
    moving: input.moving,
    currentDeskId: input.currentDeskId,
  });
  const frame = pose === "walk" ? Math.floor(input.nowMs / 140) % 2 : 0;
  const key = ensureAvatarTexture(
    scene,
    appearance,
    input.direction,
    pose,
    frame,
  );
  if (sprite.texture.key !== key) sprite.setTexture(key);
  sprite.setDepth(avatarDepthFromFeetY(sprite.y));
  sprite.setData("appearance", appearance);
}
