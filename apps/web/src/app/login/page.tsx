import type { Metadata } from "next";

import { LoginForm } from "@/components/login-form";
import { getPublicEnvironment } from "@/lib/env";
import { getCanonicalPasswordRecoveryUrl } from "@/lib/recuerda-auth-url";
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
  const passwordRecoveryUrl = getCanonicalPasswordRecoveryUrl();

  return (
    <section className="panel narrow">
      <p className="eyebrow">Acceso privado</p>
      <h1>Entra con tu correo.</h1>
      <p>
        Usa tu cuenta del Recuerda Club. Cámara y micrófono permanecen apagados.
      </p>
      {configured ? (
        <>
          <LoginForm nextPath={nextPath} />
          <p>
            <a href={passwordRecoveryUrl}>¿Olvidaste tu contraseña?</a>
          </p>
        </>
      ) : (
        <p className="error" role="alert">
          Supabase todavía no está configurado.
        </p>
      )}
    </section>
  );
}
