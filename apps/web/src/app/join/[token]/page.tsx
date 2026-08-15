import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InviteTokenSchema } from "@virtual-office/shared";

import { AccessLinkJoinForm } from "@/components/access-link-join-form";
import { getServerEnvironment } from "@/lib/env";
import { sha256Hex } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Entrar a la oficina" };
export const dynamic = "force-dynamic";

interface JoinPageProps {
  params: Promise<{ token: string }>;
}

function InvalidLinkPanel() {
  return (
    <section className="panel narrow">
      <h1>Enlace no válido</h1>
      <p>
        Este enlace no existe o fue revocado. Pide uno nuevo a la persona que
        administra tu oficina.
      </p>
    </section>
  );
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { token } = await params;
  const parsedToken = InviteTokenSchema.safeParse(token);
  if (!parsedToken.success) return <InvalidLinkPanel />;
  if (!getServerEnvironment()) redirect("/login?error=configuration");

  const admin = createAdminClient();
  const tokenHash = await sha256Hex(parsedToken.data);
  const { data: link } = await admin
    .from("office_access_links")
    .select("member_label, user_id, office_id, offices(name, slug)")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!link) return <InvalidLinkPanel />;

  const office = Array.isArray(link.offices) ? link.offices[0] : link.offices;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && link.user_id === user.id && office?.slug) {
    redirect(`/office/${encodeURIComponent(office.slug)}`);
  }

  return (
    <section className="panel narrow">
      <p className="eyebrow">Enlace personal verificado</p>
      <h1>Hola, {link.member_label}.</h1>
      <p>
        Te invitaron a {office?.name ?? "la oficina"}. Elige el nombre con el
        que te verán tus compañeros y entra. Cámara y micrófono permanecen
        apagados hasta que tú los actives.
      </p>
      <AccessLinkJoinForm
        token={parsedToken.data}
        suggestedName={link.member_label}
      />
    </section>
  );
}
