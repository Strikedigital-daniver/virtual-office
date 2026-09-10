import { z } from "zod";

export const AVATAR_APPEARANCE_VERSION = 1 as const;
export const AVATAR_SPRITE_WIDTH = 24;
export const AVATAR_SPRITE_HEIGHT = 36;
export const AVATAR_FEET_LOCAL = { x: 12, y: 35 } as const;
export const AVATAR_COLLISION = { width: 16, height: 10 } as const;

export const AvatarPoseSchema = z.enum(["idle", "walk", "seated"]);
export type AvatarPose = z.infer<typeof AvatarPoseSchema>;

export const AvatarCatalogIdSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export type AvatarCatalogItem = {
  id: string;
  label: string;
};

export const AvatarAppearanceSchema = z
  .object({
    version: z.literal(AVATAR_APPEARANCE_VERSION),
    bodyBaseId: AvatarCatalogIdSchema,
    skinToneId: AvatarCatalogIdSchema,
    faceId: AvatarCatalogIdSchema,
    eyesId: AvatarCatalogIdSchema,
    eyebrowsId: AvatarCatalogIdSchema,
    mouthId: AvatarCatalogIdSchema,
    facialHairId: AvatarCatalogIdSchema,
    hairStyleId: AvatarCatalogIdSchema,
    hairColorId: AvatarCatalogIdSchema,
    topId: AvatarCatalogIdSchema,
    bottomId: AvatarCatalogIdSchema,
    footwearId: AvatarCatalogIdSchema,
    headAccessoryId: AvatarCatalogIdSchema,
    faceAccessoryId: AvatarCatalogIdSchema,
    accessoryId: AvatarCatalogIdSchema,
  })
  .strict();

export type AvatarAppearance = z.infer<typeof AvatarAppearanceSchema>;

function items(entries: Array<[string, string]>): readonly AvatarCatalogItem[] {
  return entries.map(([id, label]) => ({ id, label }));
}

export const AVATAR_CATALOG = {
  bodyBases: items([
    ["body-compact", "Compacto"],
    ["body-standard", "Estándar"],
    ["body-tall", "Alto"],
  ]),
  skinTones: items([
    ["skin-sand", "Arena"],
    ["skin-honey", "Miel"],
    ["skin-clay", "Arcilla"],
    ["skin-umber", "Umber"],
    ["skin-bronze", "Bronce"],
    ["skin-deep", "Profundo"],
  ]),
  faces: items([
    ["face-round", "Redondo"],
    ["face-oval", "Oval"],
    ["face-soft", "Suave"],
    ["face-angular", "Angular"],
    ["face-wide", "Ancho"],
  ]),
  eyes: items([
    ["eyes-dot", "Punto"],
    ["eyes-almond", "Almendra"],
    ["eyes-wide", "Abiertos"],
    ["eyes-sleepy", "Soñolientos"],
    ["eyes-bright", "Brillantes"],
  ]),
  eyebrows: items([
    ["brows-soft", "Suaves"],
    ["brows-straight", "Rectas"],
    ["brows-arch", "Arco"],
    ["brows-none", "Sin cejas"],
  ]),
  mouths: items([
    ["mouth-smile", "Sonrisa"],
    ["mouth-neutral", "Neutra"],
    ["mouth-grin", "Grande"],
    ["mouth-smirk", "Sesgada"],
    ["mouth-open", "Abierta"],
  ]),
  facialHair: items([
    ["facial-none", "Ninguno"],
    ["facial-stubble", "Sombra"],
    ["facial-mustache", "Bigote"],
    ["facial-beard", "Barba corta"],
  ]),
  hairStyles: items([
    ["hair-none", "Rapado"],
    ["hair-short", "Corto"],
    ["hair-crop", "Crop"],
    ["hair-wave", "Onda"],
    ["hair-long", "Largo"],
    ["hair-bun", "Moño"],
    ["hair-halo", "Halo"],
    ["hair-fringe", "Flequillo"],
  ]),
  hairColors: items([
    ["hair-ink", "Tinta"],
    ["hair-soil", "Tierra"],
    ["hair-copper", "Cobre"],
    ["hair-sun", "Sol"],
    ["hair-fog", "Niebla"],
    ["hair-moss", "Musgo"],
    ["hair-violet", "Violeta"],
    ["hair-snow", "Nieve"],
  ]),
  tops: items([
    ["top-tee", "Polera"],
    ["top-tank", "Musculosa"],
    ["top-hoodie", "Canguro"],
    ["top-jacket", "Chaqueta"],
    ["top-overshirt", "Camisa"],
    ["top-knit", "Tejido"],
    ["top-vest", "Chaleco"],
    ["top-wrap", "Envolvente"],
  ]),
  bottoms: items([
    ["bottom-jeans", "Jeans"],
    ["bottom-slim", "Slim"],
    ["bottom-wide", "Ancho"],
    ["bottom-short", "Corto"],
    ["bottom-skirt", "Falda pixel"],
    ["bottom-cargo", "Cargo"],
  ]),
  footwear: items([
    ["feet-sneaker", "Zapatilla"],
    ["feet-boot", "Bota"],
    ["feet-sandal", "Sandalia"],
    ["feet-sock", "Calceta"],
  ]),
  headAccessories: items([
    ["head-none", "Ninguno"],
    ["head-cap", "Gorra"],
    ["head-beanie", "Gorro"],
    ["head-band", "Cinta"],
    ["head-sprout", "Brote"],
    ["head-antenna", "Antena"],
  ]),
  faceAccessories: items([
    ["faceacc-none", "Ninguno"],
    ["faceacc-round", "Lentes redondos"],
    ["faceacc-rect", "Lentes rectos"],
    ["faceacc-shade", "Sombra"],
    ["faceacc-mark", "Marca"],
  ]),
  accessories: items([
    ["acc-none", "Ninguno"],
    ["acc-bag", "Bolso"],
    ["acc-scarf", "Bufanda"],
    ["acc-pin", "Pin"],
  ]),
} as const;

export type AvatarCatalog = typeof AVATAR_CATALOG;

export const DEFAULT_AVATAR_APPEARANCE: AvatarAppearance = {
  version: 1,
  bodyBaseId: "body-standard",
  skinToneId: "skin-honey",
  faceId: "face-oval",
  eyesId: "eyes-almond",
  eyebrowsId: "brows-soft",
  mouthId: "mouth-smile",
  facialHairId: "facial-none",
  hairStyleId: "hair-short",
  hairColorId: "hair-soil",
  topId: "top-tee",
  bottomId: "bottom-jeans",
  footwearId: "feet-sneaker",
  headAccessoryId: "head-none",
  faceAccessoryId: "faceacc-none",
  accessoryId: "acc-none",
};

const CATEGORY_KEYS = [
  "bodyBases",
  "skinTones",
  "faces",
  "eyes",
  "eyebrows",
  "mouths",
  "facialHair",
  "hairStyles",
  "hairColors",
  "tops",
  "bottoms",
  "footwear",
  "headAccessories",
  "faceAccessories",
  "accessories",
] as const;

const FIELD_TO_CATEGORY: Record<
  Exclude<keyof AvatarAppearance, "version">,
  (typeof CATEGORY_KEYS)[number]
> = {
  bodyBaseId: "bodyBases",
  skinToneId: "skinTones",
  faceId: "faces",
  eyesId: "eyes",
  eyebrowsId: "eyebrows",
  mouthId: "mouths",
  facialHairId: "facialHair",
  hairStyleId: "hairStyles",
  hairColorId: "hairColors",
  topId: "tops",
  bottomId: "bottoms",
  footwearId: "footwear",
  headAccessoryId: "headAccessories",
  faceAccessoryId: "faceAccessories",
  accessoryId: "accessories",
};

function idSet(category: (typeof CATEGORY_KEYS)[number]): Set<string> {
  return new Set(AVATAR_CATALOG[category].map((item) => item.id));
}

export function catalogIdsAreUnique(): boolean {
  const seen = new Set<string>();
  for (const key of CATEGORY_KEYS) {
    for (const item of AVATAR_CATALOG[key]) {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
    }
  }
  return true;
}

export function isCatalogId(
  category: (typeof CATEGORY_KEYS)[number],
  id: string,
): boolean {
  return idSet(category).has(id);
}

export function appearanceLooksLikeInjection(value: unknown): boolean {
  const text = JSON.stringify(value).toLowerCase();
  return (
    text.includes("http://") ||
    text.includes("https://") ||
    text.includes("<script") ||
    text.includes("javascript:") ||
    text.includes("data:image")
  );
}

export function normalizeAvatarAppearance(value: unknown): AvatarAppearance {
  if (appearanceLooksLikeInjection(value)) return DEFAULT_AVATAR_APPEARANCE;
  if (!value || typeof value !== "object") return DEFAULT_AVATAR_APPEARANCE;
  const raw = value as Record<string, unknown>;
  if (raw.version !== AVATAR_APPEARANCE_VERSION) {
    return DEFAULT_AVATAR_APPEARANCE;
  }
  const parsed = AvatarAppearanceSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_AVATAR_APPEARANCE;
  const next = { ...parsed.data };
  for (const [field, category] of Object.entries(FIELD_TO_CATEGORY)) {
    const key = field as keyof typeof FIELD_TO_CATEGORY;
    if (!isCatalogId(category, next[key])) {
      next[key] = DEFAULT_AVATAR_APPEARANCE[key];
    }
  }
  return next;
}

export function parseAvatarAppearance(value: unknown): AvatarAppearance | null {
  if (appearanceLooksLikeInjection(value)) return null;
  const parsed = AvatarAppearanceSchema.safeParse(value);
  if (!parsed.success) return null;
  for (const [field, category] of Object.entries(FIELD_TO_CATEGORY)) {
    const key = field as keyof typeof FIELD_TO_CATEGORY;
    if (!isCatalogId(category, parsed.data[key])) return null;
  }
  return parsed.data;
}

export function randomAvatarAppearance(seed = Date.now()): AvatarAppearance {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  const pick = (category: (typeof CATEGORY_KEYS)[number]) => {
    const list = AVATAR_CATALOG[category];
    return list[next() % list.length]!.id;
  };
  return {
    version: 1,
    bodyBaseId: pick("bodyBases"),
    skinToneId: pick("skinTones"),
    faceId: pick("faces"),
    eyesId: pick("eyes"),
    eyebrowsId: pick("eyebrows"),
    mouthId: pick("mouths"),
    facialHairId: pick("facialHair"),
    hairStyleId: pick("hairStyles"),
    hairColorId: pick("hairColors"),
    topId: pick("tops"),
    bottomId: pick("bottoms"),
    footwearId: pick("footwear"),
    headAccessoryId: pick("headAccessories"),
    faceAccessoryId: pick("faceAccessories"),
    accessoryId: pick("accessories"),
  };
}

export function appearanceFingerprint(appearance: AvatarAppearance): string {
  return Object.values(appearance).join(":");
}

export function avatarDepthFromFeetY(worldY: number): number {
  return Math.round(worldY);
}

export function avatarPoseForState(input: {
  moving: boolean;
  currentDeskId?: string | null | undefined;
}): AvatarPose {
  if (input.currentDeskId) return "seated";
  if (input.moving) return "walk";
  return "idle";
}
