import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InvitationCreateForm } from "@/components/invitation-create-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Miembros" };
export const dynamic = "force-dynamic";

export default async function MembersAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/members");

  const { data: membership } = await supabase
    .from("office_members")
    .select("office_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return (
      <section className="panel narrow">
        <h1>Acceso restringido</h1>
        <p>Solo owner y administradores pueden crear invitaciones.</p>
        <a href="/">Volver a la oficina</a>
      </section>
    );
  }

  const { data: office } = await supabase
    .from("offices")
    .select("name")
    .eq("id", membership.office_id)
    .single();
  const { data: invitations } = await supabase
    .from("office_invitations")
    .select("id, email, role, expires_at, accepted_at, revoked_at")
    .eq("office_id", membership.office_id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <section className="admin-grid">
      <div className="panel">
        <p className="eyebrow">{office?.name ?? "Oficina"}</p>
        <h1>Invitar una persona</h1>
        <InvitationCreateForm officeId={membership.office_id} />
      </div>
      <div className="panel">
        <h2>Invitaciones recientes</h2>
        {invitations?.length ? (
          <ul className="invitation-list">
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                <span>{invitation.email}</span>
                <small>
                  {invitation.accepted_at
                    ? "Aceptada"
                    : invitation.revoked_at
                      ? "Revocada"
                      : `Pendiente · ${invitation.role}`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay invitaciones todavía.</p>
        )}
      </div>
    </section>
  );
}
