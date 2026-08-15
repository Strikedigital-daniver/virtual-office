"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface AccessLinkJoinFormProps {
  token: string;
  suggestedName: string;
}

export function AccessLinkJoinForm({
  token,
  suggestedName,
}: AccessLinkJoinFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(suggestedName);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const response = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, displayName }),
    });
    const result = (await response.json()) as {
      officeSlug?: string;
      error?: string;
    };
    if (!response.ok || !result.officeSlug) {
      setMessage(result.error ?? "El enlace no pudo usarse.");
      setSubmitting(false);
      return;
    }

    router.replace(`/office/${encodeURIComponent(result.officeSlug)}`);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="join-display-name">Nombre visible</label>
      <input
        id="join-display-name"
        name="displayName"
        minLength={1}
        maxLength={40}
        required
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Entrando…" : "Entrar a la oficina"}
      </button>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
