import type { SpatialAccessClass } from "@virtual-office/shared";
import {
  canAccessChatChannel,
  canCreateDirectMessagePair,
  TEMPLE_WORLD_SLUG,
  visibleChannelsForAccess,
} from "@virtual-office/shared";

import { clubSpatialEntitlementProvider } from "@/lib/spatial";
import { isRecuerdaStaffAdminViaCompatibilityBridge } from "@/lib/spatial/temporary-compatibility-bridge";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  channelMemberUserIds,
  ensureCanonicalTempleChatChannels,
  getChannelById,
  listChannelsForWorld,
  listDirectChannelsForUser,
} from "./repository";

export interface SpatialChatRequestContext {
  authUserId: string;
  displayName: string;
  accessClass: SpatialAccessClass;
  templeWorldId: string;
}

export async function requireSpatialChatContext(): Promise<SpatialChatRequestContext | null> {
  const supabase = await createClient();
  const entitlements =
    await clubSpatialEntitlementProvider.getSpatialEntitlements(supabase);
  if (!entitlements) return null;
  return {
    authUserId: entitlements.authUserId,
    displayName: entitlements.displayName,
    accessClass: entitlements.accessClass,
    templeWorldId: entitlements.templeWorldId,
  };
}

export async function listVisibleChannels(context: SpatialChatRequestContext) {
  await ensureCanonicalTempleChatChannels(context.templeWorldId);
  const canonical = await listChannelsForWorld(context.templeWorldId);
  const directs = await listDirectChannelsForUser(
    context.templeWorldId,
    context.authUserId,
  );
  return visibleChannelsForAccess(context.accessClass, context.authUserId, [
    ...canonical.filter((channel) => channel.channelKind !== "DIRECT"),
    ...directs,
  ]);
}

export async function requireAccessibleChannel(
  context: SpatialChatRequestContext,
  channelId: string,
) {
  const channel = await getChannelById(channelId);
  if (!channel || channel.worldId !== context.templeWorldId) return null;
  const members = channelMemberUserIds(channel);
  if (
    !canAccessChatChannel({
      accessClass: context.accessClass,
      channelKind: channel.channelKind,
      authUserId: context.authUserId,
      ...(members ? { memberUserIds: members } : {}),
    })
  ) {
    return null;
  }
  return channel;
}

export async function resolveDisplayName(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (profile?.display_name?.trim())
    return profile.display_name.trim().slice(0, 40);

  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const metadataName =
    typeof userData.user?.user_metadata?.display_name === "string"
      ? userData.user.user_metadata.display_name.trim()
      : "";
  return (metadataName || "Integrante").slice(0, 40);
}

export async function resolveAccessClassForUserId(
  authUserId: string,
): Promise<SpatialAccessClass | null> {
  const admin = createAdminClient();
  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(authUserId);
  if (userError || !userData.user) return null;

  const { data: world } = await admin
    .from("spatial_worlds")
    .select("id")
    .eq("slug", TEMPLE_WORLD_SLUG)
    .maybeSingle();
  if (!world?.id) return null;

  if (isRecuerdaStaffAdminViaCompatibilityBridge(userData.user.email)) {
    return "RECUERDA_STAFF";
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("source_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (profile?.source_id) {
    const { data: entitlement } = await admin
      .from("entitlements")
      .select("active")
      .eq("key", "club_access")
      .eq("profile_source_id", profile.source_id)
      .maybeSingle();
    if (entitlement?.active) return "CLUB_MEMBER";
  }

  const { data: grant } = await admin
    .from("spatial_access_grants")
    .select("expires_at, revoked_at")
    .eq("auth_user_id", authUserId)
    .eq("world_id", world.id)
    .eq("zone_key", "office")
    .eq("grant_type", "OFFICE_COLLABORATOR")
    .is("revoked_at", null)
    .maybeSingle();
  if (grant && (!grant.expires_at || new Date(grant.expires_at) > new Date())) {
    return "OFFICE_COLLABORATOR";
  }

  return null;
}

export async function assertDirectMessageTarget(input: {
  context: SpatialChatRequestContext;
  targetUserId: string;
  targetAccessClass: SpatialAccessClass;
}): Promise<boolean> {
  if (input.targetUserId === input.context.authUserId) return false;
  return canCreateDirectMessagePair(
    input.context.accessClass,
    input.targetAccessClass,
  );
}
