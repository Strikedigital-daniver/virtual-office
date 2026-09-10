import {
  DEFAULT_AVATAR_APPEARANCE,
  normalizeAvatarAppearance,
  parseAvatarAppearance,
  type AvatarAppearance,
} from "@virtual-office/shared";

export type AvatarLoadSource = "server" | "local" | "default";

export function resolveAvatarLoadPriority(input: {
  serverAvailable: boolean;
  hasLoadout: boolean;
  serverAppearance?: unknown;
  localAppearance?: AvatarAppearance | null;
}): { appearance: AvatarAppearance; source: AvatarLoadSource } {
  if (input.serverAvailable && input.hasLoadout) {
    return {
      appearance: normalizeAvatarAppearance(input.serverAppearance),
      source: "server",
    };
  }
  if (input.localAppearance) {
    return { appearance: input.localAppearance, source: "local" };
  }
  return {
    appearance: DEFAULT_AVATAR_APPEARANCE,
    source: "default",
  };
}

export function interpretAvatarSaveResponse(input: {
  ok: boolean;
  status: number;
  persisted?: boolean | undefined;
  appearance?: unknown;
}): { synced: boolean; message: string | null } {
  if (
    input.ok &&
    input.status === 200 &&
    input.persisted !== false &&
    input.appearance !== undefined
  ) {
    return { synced: true, message: null };
  }
  if (input.ok && input.status === 200 && input.persisted === true) {
    return { synced: true, message: null };
  }
  return {
    synced: false,
    message: "El avatar no se sincronizó en el servidor.",
  };
}

export function appearancesEquivalent(
  left: AvatarAppearance,
  right: AvatarAppearance,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function avatarLoadoutUpsertRow(
  authUserId: string,
  appearance: AvatarAppearance,
) {
  return {
    onConflict: "auth_user_id" as const,
    row: {
      auth_user_id: authUserId,
      appearance_version: 1,
      appearance,
    },
  };
}

export function appearanceFromStoredLoadout(
  stored: unknown,
  hasRow: boolean,
): AvatarAppearance {
  if (!hasRow) return DEFAULT_AVATAR_APPEARANCE;
  return parseAvatarAppearance(stored) ?? normalizeAvatarAppearance(stored);
}
