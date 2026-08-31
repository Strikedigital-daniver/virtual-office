"use client";

import {
  audioConstraints,
  videoConstraints,
  type MediaKind,
  type PublishedTrack,
} from "@virtual-office/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CloudflareMediaProvider } from "./cloudflare-media-provider";
import { remoteKey, type RemoteTrackRef } from "./media-provider";

export type DeviceStatus = "off" | "starting" | "on" | "failed";

export interface RemoteMedia {
  key: string;
  ref: RemoteTrackRef;
  stream: MediaStream;
  displayName: string;
}

interface Ticket {
  ticket: string;
  mediaBaseUrl: string;
  userId: string;
}

async function fetchTicket(officeSlug: string): Promise<Ticket> {
  const response = await fetch("/api/realtime-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeSlug }),
  });
  if (!response.ok) throw new Error("No se pudo obtener el acceso a medios.");
  return (await response.json()) as Ticket;
}

export function useOfficeMedia(options: {
  officeSlug: string;
  availableTracks: PublishedTrack[];
  nameFor: (userId: string) => string;
}) {
  const { officeSlug, availableTracks, nameFor } = options;
  const providerRef = useRef<CloudflareMediaProvider | null>(null);
  const selfUserIdRef = useRef<string | null>(null);
  const [micStatus, setMicStatus] = useState<DeviceStatus>("off");
  const [cameraStatus, setCameraStatus] = useState<DeviceStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<RemoteMedia[]>([]);
  const [localPreview, setLocalPreview] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  const ticketSource = useCallback(async () => {
    const ticket = await fetchTicket(officeSlug);
    selfUserIdRef.current = ticket.userId;
    return { ticket: ticket.ticket, mediaBaseUrl: ticket.mediaBaseUrl };
  }, [officeSlug]);

  useEffect(() => {
    let cancelled = false;
    let provider: CloudflareMediaProvider | null = null;

    void (async () => {
      try {
        const first = await fetchTicket(officeSlug);
        if (cancelled) return;
        selfUserIdRef.current = first.userId;
        provider = new CloudflareMediaProvider(ticketSource, first.userId, {
          onRemoteTrack: (ref, track) => {
            const stream = new MediaStream([track]);
            setRemotes((current) => [
              ...current.filter((item) => item.key !== remoteKey(ref)),
              {
                key: remoteKey(ref),
                ref,
                stream,
                displayName: nameFor(ref.ownerUserId),
              },
            ]);
          },
          onRemoteTrackClosed: (ref) => {
            setRemotes((current) =>
              current.filter((item) => item.key !== remoteKey(ref)),
            );
          },
          onState: () => undefined,
        });
        await provider.connect();
        if (cancelled) {
          void provider.disconnect();
          return;
        }
        providerRef.current = provider;
        setReady(true);
      } catch {
        if (!cancelled) setError("La sesión de medios no está disponible.");
      }
    })();

    return () => {
      cancelled = true;
      const active = providerRef.current ?? provider;
      providerRef.current = null;
      void active?.disconnect();
    };
  }, [officeSlug, ticketSource, nameFor]);

  // Subscribe to every authorized track that is not ours. Sprint 4 narrows this
  // down to proximity and rooms; the Durable Object already authorizes each pull.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !ready) return;
    const selfUserId = selfUserIdRef.current;
    for (const track of availableTracks) {
      if (track.ownerUserId === selfUserId) continue;
      void provider
        .subscribe({
          ownerUserId: track.ownerUserId,
          sessionId: track.sessionId,
          trackName: track.trackName,
          kind: track.kind,
        })
        .catch(() => undefined);
    }
    const live = new Set(
      availableTracks.map((track) =>
        remoteKey({ sessionId: track.sessionId, trackName: track.trackName }),
      ),
    );
    setRemotes((current) => {
      const stale = current.filter((item) => !live.has(item.key));
      for (const item of stale) void provider.unsubscribe(item.ref);
      return stale.length === 0
        ? current
        : current.filter((item) => live.has(item.key));
    });
  }, [availableTracks, ready]);

  const toggle = useCallback(async (kind: MediaKind, deviceId?: string) => {
    const provider = providerRef.current;
    if (!provider) return;
    const setStatus = kind === "audio" ? setMicStatus : setCameraStatus;
    const isOn = provider.publishedKinds().includes(kind);
    setError(null);

    if (isOn) {
      setStatus("off");
      if (kind === "video") setLocalPreview(null);
      await provider.unpublish(kind).catch(() => undefined);
      return;
    }

    setStatus("starting");
    try {
      const constraints: MediaStreamConstraints =
        kind === "audio"
          ? {
              audio: deviceId
                ? { ...audioConstraints, deviceId: { exact: deviceId } }
                : audioConstraints,
              video: false,
            }
          : {
              audio: false,
              video: deviceId
                ? { ...videoConstraints, deviceId: { exact: deviceId } }
                : videoConstraints,
            };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track =
        kind === "audio"
          ? stream.getAudioTracks()[0]
          : stream.getVideoTracks()[0];
      if (!track) throw new Error("El navegador no entregó una pista.");
      await provider.publish(kind, track);
      if (kind === "video") setLocalPreview(new MediaStream([track]));
      setStatus("on");
    } catch (cause) {
      setStatus("failed");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Permiso denegado por el navegador."
          : "No se pudo activar el dispositivo.",
      );
      setTimeout(() => setStatus("off"), 2_500);
    }
  }, []);

  return useMemo(
    () => ({
      ready,
      micStatus,
      cameraStatus,
      error,
      remotes,
      localPreview,
      toggleMic: (deviceId?: string) => toggle("audio", deviceId),
      toggleCamera: (deviceId?: string) => toggle("video", deviceId),
    }),
    [ready, micStatus, cameraStatus, error, remotes, localPreview, toggle],
  );
}
