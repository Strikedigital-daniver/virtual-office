import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { TEMPLE_WORLD_SLUG } from "@virtual-office/shared";

import { OfficeWorld } from "@/components/office-world";
import { clubSpatialEntitlementProvider } from "@/lib/spatial";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Templo" };
export const dynamic = "force-dynamic";

interface OfficePageProps {
  params: Promise<{ officeSlug: string }>;
}

export default async function OfficePage({ params }: OfficePageProps) {
  const { officeSlug } = await params;
  if (officeSlug !== TEMPLE_WORLD_SLUG) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    redirect(`/login?next=${encodeURIComponent(`/office/${officeSlug}`)}`);

  const entitlements =
    await clubSpatialEntitlementProvider.getSpatialEntitlements(supabase);
  if (!entitlements) {
    return (
      <section className="panel narrow">
        <p className="eyebrow">Templo</p>
        <h1>Sin acceso al Templo</h1>
        <p>Se requiere membresía activa del Recuerda Club.</p>
        <form action="/auth/signout" method="post">
          <button className="secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="office-stage">
      <header className="office-bar">
        <div>
          <p className="eyebrow">Templo</p>
          <strong>{entitlements.displayName}</strong>
        </div>
        <nav className="office-actions" aria-label="Acciones de cuenta">
          <form action="/auth/signout" method="post">
            <button className="secondary" type="submit">
              Salir
            </button>
          </form>
        </nav>
      </header>
      <OfficeWorld officeSlug={TEMPLE_WORLD_SLUG} />
    </section>
  );
}
