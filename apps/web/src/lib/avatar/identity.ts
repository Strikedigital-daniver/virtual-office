import type { AvatarAppearance } from "@virtual-office/shared";

export function cameraOffPortraitOwners(input: {
  videoOwnerIds: ReadonlySet<string>;
  audioOwnerIds: ReadonlySet<string>;
}): string[] {
  return [...input.audioOwnerIds].filter(
    (userId) => !input.videoOwnerIds.has(userId),
  );
}

export function chatIdentityAppearance(
  appearances: ReadonlyMap<string, AvatarAppearance>,
  authorUserId: string,
): AvatarAppearance | undefined {
  return appearances.get(authorUserId);
}
