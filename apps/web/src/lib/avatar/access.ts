import {
  DEFAULT_AVATAR_APPEARANCE,
  type AvatarAppearance,
} from "@virtual-office/shared";

export function avatarWriteIsForbidden(
  sessionUserId: string,
  requestedUserId?: unknown,
): boolean {
  return (
    typeof requestedUserId === "string" &&
    requestedUserId.length > 0 &&
    requestedUserId !== sessionUserId
  );
}

export function appearanceForMissingLoadout(): AvatarAppearance {
  return DEFAULT_AVATAR_APPEARANCE;
}
