import {
  AVATAR_CATALOG,
  DEFAULT_AVATAR_APPEARANCE,
  normalizeAvatarAppearance,
  randomAvatarAppearance,
  type AvatarAppearance,
} from "@virtual-office/shared";

export type AvatarCustomizerCategory = "Cara" | "Pelo" | "Ropa" | "Accesorios";

export const AVATAR_CUSTOMIZER_CATEGORIES: AvatarCustomizerCategory[] = [
  "Cara",
  "Pelo",
  "Ropa",
  "Accesorios",
];

export const AVATAR_CUSTOMIZER_FIELDS: Record<
  AvatarCustomizerCategory,
  Array<{ field: keyof Omit<AvatarAppearance, "version">; label: string }>
> = {
  Cara: [
    { field: "skinToneId", label: "Piel" },
    { field: "faceId", label: "Rostro" },
    { field: "eyesId", label: "Ojos" },
    { field: "eyebrowsId", label: "Cejas" },
    { field: "mouthId", label: "Boca" },
    { field: "facialHairId", label: "Vello" },
  ],
  Pelo: [
    { field: "hairStyleId", label: "Corte" },
    { field: "hairColorId", label: "Color" },
  ],
  Ropa: [
    { field: "bodyBaseId", label: "Base" },
    { field: "topId", label: "Torso" },
    { field: "bottomId", label: "Piernas" },
    { field: "footwearId", label: "Calzado" },
  ],
  Accesorios: [
    { field: "headAccessoryId", label: "Cabeza" },
    { field: "faceAccessoryId", label: "Rostro" },
    { field: "accessoryId", label: "Extra" },
  ],
};

const FIELD_OPTIONS: Record<
  keyof Omit<AvatarAppearance, "version">,
  readonly { id: string; label: string }[]
> = {
  bodyBaseId: AVATAR_CATALOG.bodyBases,
  skinToneId: AVATAR_CATALOG.skinTones,
  faceId: AVATAR_CATALOG.faces,
  eyesId: AVATAR_CATALOG.eyes,
  eyebrowsId: AVATAR_CATALOG.eyebrows,
  mouthId: AVATAR_CATALOG.mouths,
  facialHairId: AVATAR_CATALOG.facialHair,
  hairStyleId: AVATAR_CATALOG.hairStyles,
  hairColorId: AVATAR_CATALOG.hairColors,
  topId: AVATAR_CATALOG.tops,
  bottomId: AVATAR_CATALOG.bottoms,
  footwearId: AVATAR_CATALOG.footwear,
  headAccessoryId: AVATAR_CATALOG.headAccessories,
  faceAccessoryId: AVATAR_CATALOG.faceAccessories,
  accessoryId: AVATAR_CATALOG.accessories,
};

export function optionsForField(
  field: keyof Omit<AvatarAppearance, "version">,
) {
  return FIELD_OPTIONS[field];
}

export function createAvatarDraft(
  current: AvatarAppearance = DEFAULT_AVATAR_APPEARANCE,
): AvatarAppearance {
  return normalizeAvatarAppearance(current);
}

export function patchAvatarDraft(
  draft: AvatarAppearance,
  field: keyof Omit<AvatarAppearance, "version">,
  id: string,
): AvatarAppearance {
  return normalizeAvatarAppearance({ ...draft, [field]: id });
}

export function resetAvatarDraft(): AvatarAppearance {
  return { ...DEFAULT_AVATAR_APPEARANCE };
}

export function randomizeAvatarDraft(seed?: number): AvatarAppearance {
  return randomAvatarAppearance(seed);
}
