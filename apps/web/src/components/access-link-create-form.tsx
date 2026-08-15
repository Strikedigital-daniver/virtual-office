"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface AccessLinkCreateFormProps {
  officeId: string;
}

export function AccessLinkCreateForm({ officeId }: AccessLinkCreateFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setCreatedUrl(null);
    setCopied(false);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const response = await fetch("/api/admin/access-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId,
        memberLabel: form.get("memberLabel"),
        email: email === "" ? undefined : email,
        role: form.get("role"),
      }),
    });
    const result = (await response.json()) as {
      url?: string;
      error?: string;
    };
    if (!response.ok || !result.url) {
      setMessage(result.error ?? "No se pudo crear el enlace.");
      setSubmitting(false);
      return;
    }

    setCreatedUrl(result.url);
    setMessage(
      "Enlace creado. Cópialo ahora: no volverá a mostrarse completo.",
    );
    event.currentTarget.reset();
    setSubmitting(false);
    router.refresh();
  }

  async function copyUrl() {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="link-member-label">Nombre de la persona</label>
      <input
        id="link-member-label"
        name="memberLabel"
        minLength={1}
        maxLength={40}
        required
      />
      <label htmlFor="link-email">Correo (opcional)</label>
      <input id="link-email" name="email" type="email" />
      <label htmlFor="link-role">Rol</label>
      <select id="link-role" name="role" defaultValue="member">
        <option value="member">Miembro</option>
        <option value="freelancer">Freelancer</option>
        <option value="admin">Administrador</option>
      </select>
      <button type="submit" disabled={submitting}>
        {submitting ? "Creando…" : "Crear enlace personal"}
      </button>
      {message ? <p role="status">{message}</p> : null}
      {createdUrl ? (
        <div className="stack">
          <code className="access-link-url">{createdUrl}</code>
          <button type="button" onClick={copyUrl}>
            {copied ? "Copiado ✔" : "Copiar enlace"}
          </button>
        </div>
      ) : null}
    </form>
  );
}
