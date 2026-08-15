import { redirect } from "next/navigation";

import { getPublicEnvironment } from "@/lib/env";
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

  const { data: membership } = await supabase
    .from("office_members")
    .select("office_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return (
      <section className="panel narrow">
        <p className="eyebrow">Acceso autenticado</p>
        <h1>Tu cuenta aún no pertenece a una oficina.</h1>
        <p>
          Abre el enlace de invitación que recibiste para terminar el ingreso.
        </p>
        <form action="/auth/signout" method="post">
          <button className="secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </section>
    );
  }

  const { data: office } = await supabase
    .from("offices")
    .select("slug")
    .eq("id", membership.office_id)
    .single();
  if (!office) redirect("/login?error=membership");
  redirect(`/office/${encodeURIComponent(office.slug)}`);
}
