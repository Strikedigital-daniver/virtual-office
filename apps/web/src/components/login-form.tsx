"use client";

import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

interface LoginFormProps {
  nextPath: string;
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });

    setMessage(
      error
        ? "No pudimos iniciar el acceso. Comprueba que el correo haya sido invitado."
        : "Revisa tu correo. El enlace de acceso dura pocos minutos.",
    );
    setSubmitting(false);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="email">Correo invitado</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Enviando…" : "Enviar enlace de acceso"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
