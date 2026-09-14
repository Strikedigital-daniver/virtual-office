"use client";

import {
  MAX_PUBLIC_VIDEO_TILES,
  type AvatarAppearance,
} from "@virtual-office/shared";
import { useEffect, useMemo, useRef } from "react";

import { AvatarPreview } from "@/components/avatar-preview";
import {
  buildConversationParticipantSurfaces,
  participantShowsLiveVideo,
  type ConversationParticipantSurface,
} from "@/lib/media/participant-surface";
import type { RemoteMedia } from "@/lib/media/use-office-media";
import {
  proximityAudioOwnerIds,
  shouldMuteRemoteVideoAudio,
} from "@/lib/proximity/spatial-audio-mixer";

function ParticipantVideoSurface({
  media,
  muteAudio,
}: {
  media: RemoteMedia;
  muteAudio: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = media.stream;

  useEffect(() => {
    const element = videoRef.current;
    if (!element || element.srcObject === stream) return;
    element.srcObject = stream;
    const play = () => {
      void element.play().catch(() => undefined);
    };
    element.addEventListener("loadedmetadata", play, { once: true });
    play();
    return () => element.removeEventListener("loadedmetadata", play);
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muteAudio}
      className="participant-tile-video"
    />
  );
}

function ParticipantTile({
  participant,
  muteVideoAudio,
  canModerate,
  onSetSpeaker,
  onRemoveSpeaker,
}: {
  participant: ConversationParticipantSurface;
  muteVideoAudio: boolean;
  canModerate: boolean;
  onSetSpeaker?: (userId: string) => void;
  onRemoveSpeaker?: (userId: string) => void;
}) {
  const showVideo = participantShowsLiveVideo(participant);
  const isManualSpeaker = participant.broadcastSpeakerSource === "manual";
  const isCampfireSpeaker = participant.broadcastSpeakerSource === "zone";
  const showSpeakerAction = canModerate && (onSetSpeaker || onRemoveSpeaker);

  return (
    <figure
      className={`media-tile participant-tile${showVideo ? "" : " camera-off"}`}
      data-user-id={participant.userId}
      style={
        showVideo
          ? {
              opacity: participant.videoMedia?.videoOpacity ?? 1,
              pointerEvents:
                (participant.videoMedia?.videoOpacity ?? 0) > 0.05
                  ? "auto"
                  : "none",
              visibility:
                (participant.videoMedia?.videoOpacity ?? 0) > 0.01
                  ? "visible"
                  : "hidden",
            }
          : undefined
      }
    >
      <div className="participant-tile-surface">
        {showVideo && participant.videoMedia ? (
          <ParticipantVideoSurface
            media={participant.videoMedia}
            muteAudio={muteVideoAudio}
          />
        ) : (
          <div className="participant-tile-placeholder" aria-hidden="true">
            {participant.appearance ? (
              <AvatarPreview
                appearance={participant.appearance}
                portrait
                scale={3}
                label={participant.displayName}
              />
            ) : null}
          </div>
        )}
        {showSpeakerAction ? (
          <div className="participant-tile-hover-actions">
            {isManualSpeaker ? (
              <button
                type="button"
                className="participant-tile-speaker-action"
                onClick={() => onRemoveSpeaker?.(participant.userId)}
              >
                Quitar speaker
              </button>
            ) : (
              <button
                type="button"
                className="participant-tile-speaker-action"
                onClick={() => onSetSpeaker?.(participant.userId)}
              >
                Hacer speaker
              </button>
            )}
          </div>
        ) : null}
      </div>
      <figcaption className="participant-tile-caption">
        <span className="participant-tile-name">
          {participant.displayName}
          {isManualSpeaker ? " 📡" : isCampfireSpeaker ? " 🔥" : ""}
        </span>
        <span
          className={
            participant.micPublished
              ? "participant-tile-mic active"
              : "participant-tile-mic muted"
          }
          aria-label={
            participant.micPublished
              ? "Micrófono activo"
              : "Micrófono silenciado"
          }
        >
          {participant.micPublished ? "🎤" : "🔇"}
        </span>
      </figcaption>
    </figure>
  );
}

export function MediaTiles({
  remotes,
  localPreview,
  selfAppearance,
  selfMicOn,
  appearances,
  authorizedUserIds,
  displayNameFor,
  canModerate = false,
  publishedKindsByUser,
  broadcastSpeakerSourceFor,
  onSetSpeaker,
  onRemoveSpeaker,
}: {
  remotes: RemoteMedia[];
  localPreview: MediaStream | null;
  selfAppearance?: AvatarAppearance;
  selfMicOn?: boolean;
  appearances?: ReadonlyMap<string, AvatarAppearance>;
  authorizedUserIds: string[];
  displayNameFor: (userId: string) => string;
  canModerate?: boolean;
  publishedKindsByUser: ReadonlyMap<string, { audio: boolean; video: boolean }>;
  broadcastSpeakerSourceFor?: (
    userId: string,
  ) => "zone" | "manual" | null | undefined;
  onSetSpeaker?: (userId: string) => void;
  onRemoveSpeaker?: (userId: string) => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = localRef.current;
    if (!element) return;
    element.srcObject = localPreview;
    if (!localPreview) return;
    const play = () => {
      void element.play().catch(() => undefined);
    };
    element.addEventListener("loadedmetadata", play, { once: true });
    play();
    return () => element.removeEventListener("loadedmetadata", play);
  }, [localPreview]);

  const participantTiles = useMemo(() => {
    const input: Parameters<typeof buildConversationParticipantSurfaces>[0] = {
      authorizedUserIds,
      remotes,
      displayNameFor,
      micPublishedFor: (userId) =>
        Boolean(publishedKindsByUser.get(userId)?.audio),
      cameraPublishedFor: (userId) =>
        Boolean(publishedKindsByUser.get(userId)?.video),
    };
    if (appearances) input.appearances = appearances;
    if (broadcastSpeakerSourceFor) {
      input.broadcastSpeakerSourceFor = broadcastSpeakerSourceFor;
    }
    return buildConversationParticipantSurfaces(input).slice(
      0,
      MAX_PUBLIC_VIDEO_TILES,
    );
  }, [
    authorizedUserIds,
    remotes,
    displayNameFor,
    publishedKindsByUser,
    appearances,
    broadcastSpeakerSourceFor,
  ]);

  const proximityAudioOwners = useMemo(
    () => proximityAudioOwnerIds(remotes),
    [remotes],
  );

  const showSelfPortrait =
    !localPreview && Boolean(selfAppearance) && Boolean(selfMicOn);

  if (!localPreview && !showSelfPortrait && participantTiles.length === 0) {
    return null;
  }

  return (
    <div className="media-tiles world-spatial-media">
      {localPreview ? (
        <figure className="media-tile local">
          <video ref={localRef} autoPlay playsInline muted />
          <figcaption>Tú</figcaption>
        </figure>
      ) : showSelfPortrait && selfAppearance ? (
        <figure className="media-tile camera-off">
          <AvatarPreview
            appearance={selfAppearance}
            portrait
            scale={3}
            label="Tu avatar"
          />
          <figcaption>Tú{selfMicOn ? " 🎤" : ""}</figcaption>
        </figure>
      ) : null}
      {participantTiles.map((participant) => (
        <ParticipantTile
          key={participant.userId}
          participant={participant}
          muteVideoAudio={shouldMuteRemoteVideoAudio(
            participant.userId,
            proximityAudioOwners,
          )}
          canModerate={canModerate}
          {...(onSetSpeaker ? { onSetSpeaker } : {})}
          {...(onRemoveSpeaker ? { onRemoveSpeaker } : {})}
        />
      ))}
    </div>
  );
}
