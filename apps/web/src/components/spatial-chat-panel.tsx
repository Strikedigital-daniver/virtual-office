"use client";

import type {
  AvatarAppearance,
  SpatialChatChannelSummary,
  SpatialChatMessageRecord,
} from "@virtual-office/shared";
import {
  canAccessGeneralChat,
  canUseOfficeDirectMessages,
} from "@virtual-office/shared";
import type { SpatialAccessClass } from "@virtual-office/shared";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AvatarPreview } from "@/components/avatar-preview";
import { chatIdentityAppearance } from "@/lib/avatar/identity";
import { isTypingTarget } from "@/lib/game/keyboard-guard";
import {
  ChatDiagnosticsTrace,
  type ChatDiagnosticsSnapshot,
  type ChatLoadState,
  type ChatWsState,
} from "@/lib/spatial-debug/chat-diagnostics";

export interface SpatialChatLiveMessage extends SpatialChatMessageRecord {
  clientKey: string;
}

interface SpatialChatPanelProps {
  chatReady: boolean;
  accessClass: SpatialAccessClass;
  selfUserId: string | null;
  participants: Array<{ userId: string; displayName: string }>;
  appearances?: ReadonlyMap<string, AvatarAppearance>;
  selfAppearance?: AvatarAppearance;
  liveMessages: SpatialChatLiveMessage[];
  websocketStatus: ChatWsState;
  onOpenDirect?: (targetUserId: string) => void;
  onDiagnosticsChange?: (snapshot: ChatDiagnosticsSnapshot) => void;
}

function unreadStorageKey(channelId: string): string {
  return `spatial-chat-unread:${channelId}`;
}

function readUnread(channelId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = sessionStorage.getItem(unreadStorageKey(channelId));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeUnread(channelId: string, count: number): void {
  if (typeof window === "undefined") return;
  if (count <= 0) sessionStorage.removeItem(unreadStorageKey(channelId));
  else sessionStorage.setItem(unreadStorageKey(channelId), String(count));
}

export function SpatialChatPanel({
  chatReady,
  accessClass,
  selfUserId,
  participants,
  appearances,
  selfAppearance,
  liveMessages,
  websocketStatus,
  onOpenDirect,
  onDiagnosticsChange,
}: SpatialChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<SpatialChatChannelSummary[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SpatialChatLiveMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadState, setLoadState] = useState<ChatLoadState>("idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [ephemeral, setEphemeral] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState<{
    createdAt: string;
    id: string;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const knownMessageIdsRef = useRef(new Set<string>());
  const processedLiveIdsRef = useRef(new Set<string>());
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const diagnosticsRef = useRef(new ChatDiagnosticsTrace());
  const shouldStickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const windowListenerCountRef = useRef(0);

  const activeChannel = useMemo(
    () =>
      channels.find((channel) => channel.channelId === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const generalChannels = channels.filter(
    (channel) => channel.channelKind === "GENERAL",
  );
  const officeChannels = channels.filter(
    (channel) => channel.channelKind === "OFFICE",
  );
  const directChannels = channels.filter(
    (channel) => channel.channelKind === "DIRECT",
  );

  const refreshChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    diagnosticsRef.current.transition("REFRESH_CHANNELS");
    try {
      const response = await fetch("/api/spatial-chat/channels");
      diagnosticsRef.current.restFinished(
        response.status,
        response.ok ? null : "channels failed",
      );
      if (!response.ok) {
        setChannelsError("No se pudieron cargar los canales.");
        return;
      }
      const payload = (await response.json()) as {
        channels: SpatialChatChannelSummary[];
        ephemeral?: boolean;
      };
      setChannels(payload.channels);
      setEphemeral(Boolean(payload.ephemeral));
      setUnread((current) => {
        const next = { ...current };
        for (const channel of payload.channels) {
          if (next[channel.channelId] === undefined) {
            next[channel.channelId] = readUnread(channel.channelId);
          }
        }
        return next;
      });
      setActiveChannelId(
        (current) => current ?? payload.channels[0]?.channelId ?? null,
      );
      if (payload.channels.length === 0) {
        setChannelsError("No hay canales disponibles para tu acceso.");
      }
    } catch (cause) {
      setChannelsError("No se pudieron cargar los canales.");
      diagnosticsRef.current.restFinished(
        0,
        cause instanceof Error ? cause.message : "channels exception",
      );
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  const publishDiagnostics = useCallback(() => {
    const queuedLiveMessages = liveMessages.filter(
      (message) => !processedLiveIdsRef.current.has(message.messageId),
    ).length;
    onDiagnosticsChange?.(
      diagnosticsRef.current.snapshot({
        selectedChannelId: activeChannelId,
        panelOpen: open,
        initialLoad: loadState,
        sending,
        restAuthenticated: chatReady,
        websocket: websocketStatus,
        renderedMessageCount: messages.length,
        queuedLiveMessages,
        liveBufferSize: liveMessages.length,
        inputFocused,
        keyboardGuardActive: isTypingTarget(document.activeElement),
        channelsLoading,
        loadGeneration: loadGenerationRef.current,
      }),
    );
  }, [
    activeChannelId,
    open,
    loadState,
    sending,
    chatReady,
    websocketStatus,
    messages.length,
    liveMessages,
    inputFocused,
    channelsLoading,
    onDiagnosticsChange,
  ]);

  useEffect(() => {
    publishDiagnostics();
  }, [publishDiagnostics]);

  const loadMessages = useCallback(
    async (channelId: string, cursor?: { createdAt: string; id: string }) => {
      const generation = ++loadGenerationRef.current;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      setLoading(true);
      setLoadState("loading");
      setError(null);
      diagnosticsRef.current.transition(
        cursor ? "LOAD_OLDER_START" : "LOAD_CHANNEL_START",
      );
      try {
        const params = new URLSearchParams({ channelId });
        if (cursor) {
          params.set("cursorCreatedAt", cursor.createdAt);
          params.set("cursorId", cursor.id);
        }
        const response = await fetch(`/api/spatial-chat/messages?${params}`, {
          signal: controller.signal,
        });
        diagnosticsRef.current.restFinished(
          response.status,
          response.ok ? null : "load failed",
        );
        if (generation !== loadGenerationRef.current) return;
        if (!response.ok) {
          setError("No se pudo cargar el historial.");
          setLoadState("error");
          return;
        }
        const payload = (await response.json()) as {
          messages: SpatialChatMessageRecord[];
          nextCursor: { createdAt: string; id: string } | null;
        };
        const mapped = payload.messages.map((message) => ({
          ...message,
          clientKey: message.messageId,
        }));
        setNextCursor(payload.nextCursor);
        setMessages((current) => {
          const merged = cursor ? [...mapped, ...current] : mapped;
          const unique = new Map<string, SpatialChatLiveMessage>();
          for (const message of merged) {
            unique.set(message.messageId, message);
            knownMessageIdsRef.current.add(message.messageId);
          }
          return [...unique.values()].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
        });
        setLoadState("success");
        diagnosticsRef.current.transition("LOAD_SUCCESS");
      } catch (cause) {
        if (controller.signal.aborted) {
          diagnosticsRef.current.transition("LOAD_ABORTED");
          if (generation === loadGenerationRef.current) {
            setLoading(false);
            setLoadState((current) =>
              current === "loading" ? "idle" : current,
            );
          }
          return;
        }
        setError("No se pudo cargar el historial.");
        setLoadState("error");
        diagnosticsRef.current.restFinished(
          0,
          cause instanceof Error ? cause.message : "load exception",
        );
      } finally {
        if (generation === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!chatReady) return;
    void refreshChannels();
  }, [chatReady, refreshChannels]);

  useEffect(() => {
    if (!open || !chatReady) return;
    void refreshChannels();
  }, [open, chatReady, refreshChannels]);

  useEffect(() => {
    const onSelect = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId: string }>).detail;
      if (detail?.channelId) {
        setActiveChannelId(detail.channelId);
        setOpen(true);
        void refreshChannels();
      }
    };
    window.addEventListener("spatial-chat-select-channel", onSelect);
    windowListenerCountRef.current = 1;
    diagnosticsRef.current.setListenerCount(windowListenerCountRef.current);
    return () => {
      window.removeEventListener("spatial-chat-select-channel", onSelect);
      windowListenerCountRef.current = 0;
      diagnosticsRef.current.setListenerCount(0);
    };
  }, [refreshChannels]);

  useEffect(() => {
    if (!activeChannelId) return;
    knownMessageIdsRef.current = new Set();
    shouldStickToBottomRef.current = true;
    setMessages([]);
    diagnosticsRef.current.transition("CHANNEL_SWITCH");
    void loadMessages(activeChannelId);
    setUnread((current) => {
      const next = { ...current, [activeChannelId]: 0 };
      writeUnread(activeChannelId, 0);
      return next;
    });
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [activeChannelId, loadMessages]);

  useEffect(() => {
    if (!activeChannel) return;

    for (const liveMessage of liveMessages) {
      if (processedLiveIdsRef.current.has(liveMessage.messageId)) continue;
      processedLiveIdsRef.current.add(liveMessage.messageId);
      diagnosticsRef.current.liveEvent();
      if (liveMessage.channelId !== activeChannel.channelId) {
        setUnread((current) => {
          const nextCount = (current[liveMessage.channelId] ?? 0) + 1;
          writeUnread(liveMessage.channelId, nextCount);
          return { ...current, [liveMessage.channelId]: nextCount };
        });
        continue;
      }
      if (knownMessageIdsRef.current.has(liveMessage.messageId)) continue;
      knownMessageIdsRef.current.add(liveMessage.messageId);
      setMessages((current) => [...current, liveMessage]);
    }
  }, [liveMessages, activeChannel]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !shouldStickToBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, activeChannelId]);

  useEffect(() => {
    return () => {
      loadAbortRef.current?.abort();
      diagnosticsRef.current.transition("PANEL_UNMOUNT");
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeChannelId || !draft.trim() || sending) return;
    const clientMessageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const body = draft.trim();
    setDraft("");
    setError(null);
    setSending(true);
    diagnosticsRef.current.transition("SEND_START");
    try {
      const response = await fetch("/api/spatial-chat/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: activeChannelId,
          body,
          clientMessageId,
        }),
      });
      diagnosticsRef.current.restFinished(
        response.status,
        response.ok ? null : "send failed",
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error ?? "No se pudo enviar el mensaje.");
        setDraft(body);
        diagnosticsRef.current.transition("SEND_ERROR");
        return;
      }
      const payload = (await response.json()) as {
        message: SpatialChatMessageRecord;
        warning?: string;
      };
      if (response.status === 202 && payload.warning) {
        diagnosticsRef.current.fanoutWarning(payload.warning);
      }
      const mapped: SpatialChatLiveMessage = {
        ...payload.message,
        clientKey: payload.message.messageId,
      };
      if (!knownMessageIdsRef.current.has(mapped.messageId)) {
        knownMessageIdsRef.current.add(mapped.messageId);
        setMessages((current) => [...current, mapped]);
      }
      shouldStickToBottomRef.current = true;
      diagnosticsRef.current.transition("SEND_SUCCESS");
    } catch (cause) {
      setError("No se pudo enviar el mensaje.");
      setDraft(body);
      diagnosticsRef.current.restFinished(
        0,
        cause instanceof Error ? cause.message : "send exception",
      );
      diagnosticsRef.current.transition("SEND_ERROR");
    } finally {
      setSending(false);
    }
  };

  const canMessageParticipants = canUseOfficeDirectMessages(accessClass);

  return (
    <section
      className={`spatial-chat-panel${open ? "" : " collapsed"}`}
      aria-label="Chat espacial"
    >
      <header className="spatial-chat-header">
        <button
          type="button"
          className="spatial-chat-toggle"
          aria-expanded={open}
          aria-label={open ? "Cerrar chat" : "Abrir chat"}
          onClick={() => {
            setOpen((value) => {
              const nextOpen = !value;
              diagnosticsRef.current.transition(
                value ? "PANEL_CLOSE" : "PANEL_OPEN",
              );
              if (!nextOpen) {
                inputRef.current?.blur();
                setInputFocused(false);
              }
              return nextOpen;
            });
          }}
        >
          <span className="spatial-chat-hamburger" aria-hidden="true">
            ☰
          </span>
          <span className="spatial-chat-title">Chat</span>
        </button>
        {open ? (
          <span className="spatial-chat-subtitle">
            {ephemeral ? "Modo prueba (sin guardar)" : "Mensajes persistentes"}
          </span>
        ) : null}
      </header>
      {open ? (
        <div className="spatial-chat-body">
          <nav className="spatial-chat-channels" aria-label="Canales">
            {channelsLoading && channels.length === 0 ? (
              <p className="spatial-chat-empty">Cargando canales…</p>
            ) : null}
            {channelsError ? (
              <p className="spatial-chat-error">{channelsError}</p>
            ) : null}
            {canAccessGeneralChat(accessClass)
              ? generalChannels.map((channel) => (
                  <button
                    key={channel.channelId}
                    type="button"
                    className={
                      channel.channelId === activeChannelId
                        ? "spatial-chat-channel active"
                        : "spatial-chat-channel"
                    }
                    onClick={() => setActiveChannelId(channel.channelId)}
                  >
                    {channel.displayName}
                    {unread[channel.channelId]
                      ? ` (${unread[channel.channelId]})`
                      : ""}
                  </button>
                ))
              : null}
            {officeChannels.map((channel) => (
              <button
                key={channel.channelId}
                type="button"
                className={
                  channel.channelId === activeChannelId
                    ? "spatial-chat-channel active"
                    : "spatial-chat-channel"
                }
                onClick={() => setActiveChannelId(channel.channelId)}
              >
                {channel.displayName} 🔒
                {unread[channel.channelId]
                  ? ` (${unread[channel.channelId]})`
                  : ""}
              </button>
            ))}
            {canMessageParticipants ? (
              <div className="spatial-chat-directs">
                <p className="spatial-chat-directs-title">Directos</p>
                {directChannels.map((channel) => (
                  <button
                    key={channel.channelId}
                    type="button"
                    className={
                      channel.channelId === activeChannelId
                        ? "spatial-chat-channel active"
                        : "spatial-chat-channel"
                    }
                    onClick={() => setActiveChannelId(channel.channelId)}
                  >
                    {channel.displayName}
                    {unread[channel.channelId]
                      ? ` (${unread[channel.channelId]})`
                      : ""}
                  </button>
                ))}
                {participants
                  .filter((participant) => participant.userId !== selfUserId)
                  .map((participant) => (
                    <button
                      key={`dm-start-${participant.userId}`}
                      type="button"
                      className="spatial-chat-dm-start"
                      onClick={() => onOpenDirect?.(participant.userId)}
                    >
                      Mensaje → {participant.displayName}
                    </button>
                  ))}
              </div>
            ) : null}
          </nav>
          <div
            ref={listRef}
            className="spatial-chat-log"
            role="log"
            onScroll={() => {
              const list = listRef.current;
              if (!list) return;
              const distance =
                list.scrollHeight - list.scrollTop - list.clientHeight;
              shouldStickToBottomRef.current = distance < 48;
            }}
          >
            {loading && messages.length === 0 ? (
              <p className="spatial-chat-empty">Cargando historial…</p>
            ) : null}
            {!loading && messages.length === 0 ? (
              <p className="spatial-chat-empty">Aún no hay mensajes aquí.</p>
            ) : null}
            {nextCursor ? (
              <button
                type="button"
                className="spatial-chat-load-older"
                disabled={loading}
                onClick={() =>
                  activeChannelId
                    ? void loadMessages(activeChannelId, nextCursor)
                    : undefined
                }
              >
                Cargar anteriores
              </button>
            ) : null}
            {messages.map((message) => {
              const appearance =
                message.authorUserId === selfUserId
                  ? selfAppearance
                  : chatIdentityAppearance(
                      appearances ?? new Map(),
                      message.authorUserId,
                    );
              return (
                <p key={message.clientKey} className="spatial-chat-line">
                  {appearance ? (
                    <AvatarPreview
                      appearance={appearance}
                      portrait
                      scale={1}
                      label={message.displayName}
                    />
                  ) : null}
                  <strong>{message.displayName}</strong>: {message.body}
                </p>
              );
            })}
          </div>
          {error ? <p className="spatial-chat-error">{error}</p> : null}
          <form
            className="spatial-chat-form"
            onSubmit={submit}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="text"
              maxLength={2000}
              value={draft}
              disabled={!chatReady || !activeChannelId || channelsLoading}
              placeholder={
                channelsLoading
                  ? "Cargando canales…"
                  : activeChannel
                    ? `Mensaje en ${activeChannel.displayName}…`
                    : channelsError
                      ? "Chat no disponible"
                      : "Selecciona un canal…"
              }
              onChange={(event) => setDraft(event.target.value)}
              onFocus={() => {
                setInputFocused(true);
                diagnosticsRef.current.transition("INPUT_FOCUS");
              }}
              onBlur={() => {
                setInputFocused(false);
                diagnosticsRef.current.transition("INPUT_BLUR");
              }}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <button
              type="submit"
              disabled={
                !chatReady || !activeChannelId || !draft.trim() || sending
              }
            >
              Enviar
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
