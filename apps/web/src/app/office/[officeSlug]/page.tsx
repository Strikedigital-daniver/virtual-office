import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Oficina" };
export const dynamic = "force-dynamic";

interface OfficePageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function OfficePage({ params }: OfficePageProps) {
  const { officeSlug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    redirect(`/login?next=${encodeURIComponent(`/office/${officeSlug}`)}`);

  const { data: office } = await supabase
    .from("offices")
    .select("id, name, slug, max_members")
    .eq("slug", officeSlug)
    .maybeSingle();
  if (!office) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <section className="office-shell">
      <div className="office-copy">
        <p className="eyebrow">Acceso autorizado</p>
        <h1>{office.name}</h1>
        <p>
          Hola, {profile?.display_name ?? user.email ?? "miembro"}. La sesión,
          membresía y shell PWA están activos.
        </p>
      </div>
      <div className="foundation-card" aria-label="Límite actual del Sprint 1">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>Fundación conectada</strong>
          <p>
            El mapa y los dispositivos se incorporarán en sus sprints
            autorizados.
          </p>
        </div>
      </div>
      <nav className="office-actions" aria-label="Acciones de cuenta">
        <a className="button-link secondary" href="/admin/members">
          Administrar miembros
        </a>
        <form action="/auth/signout" method="post">
          <button className="secondary" type="submit">
            Salir
          </button>
        </form>
      </nav>
    </section>
  );
}
