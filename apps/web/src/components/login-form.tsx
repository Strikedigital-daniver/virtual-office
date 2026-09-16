"use client";

import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

interface LoginFormProps {
  nextPath: string;
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setMessage("Escribe un correo válido.");
      setSubmitting(false);
      return;
    }

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) {
        setMessage("Correo o contraseña incorrectos.");
        return;
      }

      window.location.assign(nextPath);
    } catch {
      setMessage("No se pudo conectar. Intenta entrar nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} method="post" action="#">
      <label htmlFor="email">Correo</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="password">Contraseña</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Entrando…" : "Entrar"}
      </button>
      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
