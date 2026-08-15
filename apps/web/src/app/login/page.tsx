import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";
import { getPublicEnvironment } from "@/lib/env";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Ingresar" };
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextValue = Array.isArray(query.next) ? query.next[0] : query.next;
  const nextPath = safeRedirectPath(nextValue);
  const configured = Boolean(getPublicEnvironment());

  return (
    <section className="panel narrow">
      <p className="eyebrow">Acceso privado</p>
      <h1>Entra con tu correo invitado.</h1>
      <p>No existe registro público. Cámara y micrófono permanecen apagados.</p>
      {configured ? (
        <LoginForm nextPath={nextPath} />
      ) : (
        <p className="error" role="alert">
          Supabase todavía no está configurado.
        </p>
      )}
    </section>
  );
}
