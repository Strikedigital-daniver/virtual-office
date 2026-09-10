import type { AvatarAppearance } from "@virtual-office/shared";

import type { RemoteMedia } from "@/lib/media/use-office-media";

export interface ConversationParticipantSurface {
  userId: string;
  displayName: string;
  authorized: boolean;
  micPublished: boolean;
  cameraPublished: boolean;
  videoMedia: RemoteMedia | null;
  appearance?: AvatarAppearance;
  broadcastSpeakerSource?: "zone" | "manual" | null;
}

export function buildConversationParticipantSurfaces(input: {
  authorizedUserIds: Iterable<string>;
  remotes: RemoteMedia[];
  displayNameFor: (userId: string) => string;
  micPublishedFor: (userId: string) => boolean;
  cameraPublishedFor: (userId: string) => boolean;
  appearances?: ReadonlyMap<string, AvatarAppearance>;
  broadcastSpeakerSourceFor?: (
    userId: string,
  ) => "zone" | "manual" | null | undefined;
}): ConversationParticipantSurface[] {
  const surfaces: ConversationParticipantSurface[] = [];
  for (const userId of input.authorizedUserIds) {
    const videoMedia =
      input.remotes.find(
        (media) =>
          media.ref.kind === "video" &&
          media.ref.ownerUserId === userId &&
          media.subscribed,
      ) ?? null;
    const appearance = input.appearances?.get(userId);
    surfaces.push({
      userId,
      displayName: input.displayNameFor(userId),
      authorized: true,
      micPublished: input.micPublishedFor(userId),
      cameraPublished: input.cameraPublishedFor(userId),
      videoMedia,
      ...(appearance ? { appearance } : {}),
      broadcastSpeakerSource: input.broadcastSpeakerSourceFor?.(userId) ?? null,
    });
  }
  return surfaces;
}

export function participantShowsLiveVideo(
  participant: ConversationParticipantSurface,
): boolean {
  return (
    participant.cameraPublished &&
    participant.videoMedia !== null &&
    participant.videoMedia.videoOpacity > 0.01
  );
}

export function participantTileVideoKey(
  participant: ConversationParticipantSurface,
): string | null {
  if (!participantShowsLiveVideo(participant)) return null;
  return participant.videoMedia!.key;
}
