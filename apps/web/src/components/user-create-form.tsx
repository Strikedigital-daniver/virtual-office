"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface UserCreateFormProps {
  officeId: string;
}

export function UserCreateForm({ officeId }: UserCreateFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeId,
        username,
        password: form.get("password"),
        role: form.get("role"),
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "No se pudo crear el usuario.");
      setSubmitting(false);
      return;
    }

    setMessage(
      `Usuario "${username}" creado. Pásale su usuario y contraseña directamente.`,
    );
    event.currentTarget.reset();
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="new-username">Nombre de usuario</label>
      <input
        id="new-username"
        name="username"
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        minLength={2}
        maxLength={20}
        pattern="[A-Za-z0-9]+"
        title="Solo letras y números, sin espacios"
        required
      />
      <label htmlFor="new-password">Contraseña</label>
      <input
        id="new-password"
        name="password"
        type="text"
        autoComplete="off"
        minLength={8}
        maxLength={72}
        required
      />
      <label htmlFor="new-role">Rol</label>
      <select id="new-role" name="role" defaultValue="member">
        <option value="member">Miembro</option>
        <option value="freelancer">Freelancer</option>
        <option value="admin">Administrador</option>
      </select>
      <button type="submit" disabled={submitting}>
        {submitting ? "Creando…" : "Crear usuario"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
