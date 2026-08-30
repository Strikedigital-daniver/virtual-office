import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OfficeWorld } from "@/components/office-world";
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
  const { data: membership } = await supabase
    .from("office_members")
    .select("role")
    .eq("office_id", office.id)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  const canAdminister =
    membership?.role === "owner" || membership?.role === "admin";

  return (
    <section className="office-stage">
      <header className="office-bar">
        <div>
          <p className="eyebrow">{office.name}</p>
          <strong>{profile?.display_name ?? "Integrante"}</strong>
        </div>
        <nav className="office-actions" aria-label="Acciones de cuenta">
          {canAdminister ? (
            <a className="button-link secondary" href="/admin/members">
              Usuarios
            </a>
          ) : null}
          <form action="/auth/signout" method="post">
            <button className="secondary" type="submit">
              Salir
            </button>
          </form>
        </nav>
      </header>
      <OfficeWorld officeSlug={office.slug} />
    </section>
  );
}
