"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { parseImplicitSessionHash } from "@/lib/implicit-session";
import { createClient } from "@/lib/supabase/client";

interface InvitationSessionBootstrapProps {
  token: string;
}

export function InvitationSessionBootstrap({
  token,
}: InvitationSessionBootstrapProps) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    async function establishSession() {
      const supabase = createClient();
      const implicitSession = parseImplicitSessionHash(window.location.hash);

      if (implicitSession) {
        const { error } = await supabase.auth.setSession(implicitSession);
        if (error) {
          if (active) setFailed(true);
          return;
        }

        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active) return;

      if (user) {
        router.refresh();
        return;
      }

      setFailed(true);
    }

    void establishSession();
    return () => {
      active = false;
    };
  }, [router]);

  const nextPath = `/invite/${token}`;

  return (
    <section className="panel narrow">
      <p className="eyebrow">Invitación privada</p>
      <h1>{failed ? "Confirma tu sesión." : "Validando invitación…"}</h1>
      {failed ? (
        <>
          <p>
            El enlace no contiene una sesión válida o ya expiró. Solicita un
            enlace de acceso para el mismo correo invitado.
          </p>
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>
            Solicitar enlace de acceso
          </Link>
        </>
      ) : (
        <p>Estamos preparando tu acceso seguro a mhcave.</p>
      )}
    </section>
  );
}
