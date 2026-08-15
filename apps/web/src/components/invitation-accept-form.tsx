"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface InvitationAcceptFormProps {
  token: string;
}

export function InvitationAcceptForm({ token }: InvitationAcceptFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, displayName }),
    });
    const result = (await response.json()) as {
      officeSlug?: string;
      error?: string;
    };
    if (!response.ok || !result.officeSlug) {
      setMessage(result.error ?? "La invitación no pudo aceptarse.");
      setSubmitting(false);
      return;
    }

    router.replace(`/office/${encodeURIComponent(result.officeSlug)}`);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="display-name">Nombre visible</label>
      <input
        id="display-name"
        name="displayName"
        minLength={1}
        maxLength={40}
        required
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Aceptando…" : "Aceptar invitación"}
      </button>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
