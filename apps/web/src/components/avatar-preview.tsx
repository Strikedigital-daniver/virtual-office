"use client";

import {
  AVATAR_SPRITE_HEIGHT,
  AVATAR_SPRITE_WIDTH,
  composeAvatarPortraitRgba,
  composeAvatarRgba,
  type AvatarAppearance,
} from "@virtual-office/shared";
import { useEffect, useRef } from "react";

function paint(
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
) {
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return;
  const image = sourceCtx.createImageData(width, height);
  image.data.set(pixels);
  sourceCtx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
}

export function AvatarPreview({
  appearance,
  portrait = false,
  scale = 4,
  label,
}: {
  appearance: AvatarAppearance;
  portrait?: boolean;
  scale?: number;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (portrait) {
      paint(
        canvas,
        composeAvatarPortraitRgba(appearance),
        AVATAR_SPRITE_WIDTH,
        16,
        scale,
      );
      return;
    }
    paint(
      canvas,
      composeAvatarRgba(appearance, "down", "idle", 0),
      AVATAR_SPRITE_WIDTH,
      AVATAR_SPRITE_HEIGHT,
      scale,
    );
  }, [appearance, portrait, scale]);

  return (
    <canvas
      ref={ref}
      className="avatar-preview-canvas"
      aria-label={label ?? "Vista previa del avatar"}
    />
  );
}
