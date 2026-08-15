"use client";

import { useState, type FormEvent } from "react";

interface InvitationCreateFormProps {
  officeId: string;
}

export function InvitationCreateForm({ officeId }: InvitationCreateFormProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId,
        email: form.get("email"),
        role: form.get("role"),
        expiresInHours: 24,
      }),
    });
    const result = (await response.json()) as { error?: string };
    setMessage(
      response.ok
        ? "Invitación enviada. Caduca en 24 horas."
        : (result.error ?? "No se pudo enviar la invitación."),
    );
    if (response.ok) event.currentTarget.reset();
    setSubmitting(false);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="invite-email">Correo</label>
      <input id="invite-email" name="email" type="email" required />
      <label htmlFor="invite-role">Rol</label>
      <select id="invite-role" name="role" defaultValue="member">
        <option value="member">Miembro</option>
        <option value="freelancer">Freelancer</option>
        <option value="admin">Administrador</option>
      </select>
      <button type="submit" disabled={submitting}>
        {submitting ? "Enviando…" : "Enviar invitación"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
