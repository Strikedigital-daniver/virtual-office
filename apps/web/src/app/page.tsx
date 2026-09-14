import { redirect } from "next/navigation";

import { TEMPLE_WORLD_SLUG } from "@virtual-office/shared";

import { getPublicEnvironment } from "@/lib/env";
import { clubSpatialEntitlementProvider } from "@/lib/spatial";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!getPublicEnvironment()) {
    return (
      <section className="panel narrow">
        <p className="eyebrow">Sprint 1</p>
        <h1>La base está lista para conectarse.</h1>
        <p>
          Falta configurar las claves públicas de Supabase. Hasta entonces no se
          habilita ningún acceso ni se simula una sesión.
        </p>
      </section>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const entitlements =
    await clubSpatialEntitlementProvider.getSpatialEntitlements(supabase);
  if (!entitlements) {
    return (
      <section className="panel narrow">
        <p className="eyebrow">Acceso autenticado</p>
        <h1>Tu cuenta no tiene acceso activo al Recuerda Club.</h1>
        <p>
          Se requiere una membresía activa con <code>club_access</code> para
          entrar al Templo.
        </p>
        <form action="/auth/signout" method="post">
          <button className="secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </section>
    );
  }

  redirect(`/office/${encodeURIComponent(TEMPLE_WORLD_SLUG)}`);
}
