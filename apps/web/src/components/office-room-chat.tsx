"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

export interface RoomChatMessage {
  id: string;
  userId: string;
  displayName: string;
  text: string;
  serverTime: number;
}

interface OfficeRoomChatProps {
  messages: RoomChatMessage[];
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function OfficeRoomChat({
  messages,
  onSend,
  disabled = false,
}: OfficeRoomChatProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <section className="office-room-chat" aria-label="Chat general del Templo">
      <header>
        <strong>Chat general</strong>
        <span>Coordina aquí si el audio falla</span>
      </header>
      <div ref={listRef} className="office-room-chat-log" role="log">
        {messages.length === 0 ? (
          <p className="office-room-chat-empty">
            Escribe para avisar instrucciones al equipo.
          </p>
        ) : (
          messages.map((message) => (
            <p key={message.id} className="office-room-chat-line">
              <strong>{message.displayName}</strong>: {message.text}
            </p>
          ))
        )}
      </div>
      <form className="office-room-chat-form" onSubmit={submit}>
        <input
          type="text"
          maxLength={280}
          value={draft}
          disabled={disabled}
          placeholder="Mensaje para todos en el Templo…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={disabled || !draft.trim()}>
          Enviar
        </button>
      </form>
    </section>
  );
}
