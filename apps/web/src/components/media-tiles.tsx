"use client";

import { MAX_PUBLIC_VIDEO_TILES } from "@virtual-office/shared";
import { useEffect, useRef } from "react";

import type { RemoteMedia } from "@/lib/media/use-office-media";

function MediaTile({ media }: { media: RemoteMedia }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element =
      media.ref.kind === "video" ? videoRef.current : audioRef.current;
    if (!element) return;
    element.srcObject = media.stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [media]);

  if (media.ref.kind === "audio") {
    return <audio ref={audioRef} autoPlay playsInline />;
  }

  return (
    <figure className="media-tile">
      <video ref={videoRef} autoPlay playsInline muted={false} />
      <figcaption>{media.displayName}</figcaption>
    </figure>
  );
}

export function MediaTiles({
  remotes,
  localPreview,
}: {
  remotes: RemoteMedia[];
  localPreview: MediaStream | null;
}) {
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = localRef.current;
    if (!element) return;
    element.srcObject = localPreview;
    if (localPreview) void element.play().catch(() => undefined);
  }, [localPreview]);

  const videos = remotes
    .filter((media) => media.ref.kind === "video")
    .slice(0, MAX_PUBLIC_VIDEO_TILES);
  const audios = remotes.filter((media) => media.ref.kind === "audio");

  if (!localPreview && videos.length === 0 && audios.length === 0) return null;

  return (
    <div className="media-tiles">
      {localPreview ? (
        <figure className="media-tile local">
          <video ref={localRef} autoPlay playsInline muted />
          <figcaption>Tú</figcaption>
        </figure>
      ) : null}
      {videos.map((media) => (
        <MediaTile key={media.key} media={media} />
      ))}
      {audios.map((media) => (
        <MediaTile key={media.key} media={media} />
      ))}
    </div>
  );
}
