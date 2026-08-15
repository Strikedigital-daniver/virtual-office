import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InviteTokenSchema } from "@virtual-office/shared";

import { InvitationAcceptForm } from "@/components/invitation-accept-form";
import { InvitationSessionBootstrap } from "@/components/invitation-session-bootstrap";
import { getPublicEnvironment } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Aceptar invitación" };
export const dynamic = "force-dynamic";

interface InvitationPageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const { token } = await params;
  const parsedToken = InviteTokenSchema.safeParse(token);
  if (!parsedToken.success) {
    return (
      <section className="panel narrow">
        <h1>Invitación no válida</h1>
        <p>Solicita una invitación nueva al administrador.</p>
      </section>
    );
  }
  if (!getPublicEnvironment()) redirect("/login?error=configuration");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return <InvitationSessionBootstrap token={parsedToken.data} />;
  }

  return (
    <section className="panel narrow">
      <p className="eyebrow">Invitación verificada por correo</p>
      <h1>Completa tu perfil.</h1>
      <p>El nombre será visible únicamente para integrantes de tu oficina.</p>
      <InvitationAcceptForm token={parsedToken.data} />
    </section>
  );
}
