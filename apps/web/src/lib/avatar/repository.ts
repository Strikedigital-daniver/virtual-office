import {
  DEFAULT_AVATAR_APPEARANCE,
  normalizeAvatarAppearance,
  parseAvatarAppearance,
  type AvatarAppearance,
} from "@virtual-office/shared";

import { avatarLoadoutUpsertRow } from "@/lib/avatar/persistence";
import { createAdminClient } from "@/lib/supabase/admin";

const LOCAL_KEY = "spatial-avatar-loadout-v1";

export interface AvatarLoadResult {
  appearance: AvatarAppearance;
  hasLoadout: boolean;
}

export async function loadAvatarAppearance(
  authUserId: string,
): Promise<AvatarLoadResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("spatial_avatar_loadouts")
    .select("appearance")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { appearance: DEFAULT_AVATAR_APPEARANCE, hasLoadout: false };
  }
  return {
    appearance: normalizeAvatarAppearance(data.appearance),
    hasLoadout: true,
  };
}

export async function saveAvatarAppearance(input: {
  authUserId: string;
  appearance: unknown;
}): Promise<AvatarAppearance> {
  const appearance = parseAvatarAppearance(input.appearance);
  if (!appearance) {
    throw new Error("Apariencia no válida.");
  }
  const spec = avatarLoadoutUpsertRow(input.authUserId, appearance);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("spatial_avatar_loadouts")
    .upsert(
      {
        ...spec.row,
        updated_at: new Date().toISOString(),
      },
      { onConflict: spec.onConflict },
    )
    .select("appearance")
    .single();
  if (error) throw error;
  if (!data) throw new Error("La persistencia del avatar no devolvió fila.");
  return normalizeAvatarAppearance(data.appearance);
}

export function readLocalAvatarFallback(): AvatarAppearance | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return parseAvatarAppearance(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeLocalAvatarFallback(appearance: AvatarAppearance): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(appearance));
}
