import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccessLinkCreateForm } from "@/components/access-link-create-form";
import { AccessLinkRevokeButton } from "@/components/access-link-revoke-button";
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
  const { data: accessLinks } = await supabase
    .from("office_access_links")
    .select("id, member_label, role, user_id, revoked_at, last_used_at")
    .eq("office_id", membership.office_id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <section className="admin-grid">
      <div className="panel">
        <p className="eyebrow">{office?.name ?? "Oficina"}</p>
        <h1>Enlace personal</h1>
        <p>
          Crea un enlace por persona y envíaselo por un canal directo. Quien lo
          abra entra con su nombre, sin correos.
        </p>
        <AccessLinkCreateForm officeId={membership.office_id} />
      </div>
      <div className="panel">
        <h2>Enlaces creados</h2>
        {accessLinks?.length ? (
          <ul className="invitation-list">
            {accessLinks.map((link) => (
              <li key={link.id}>
                <span>{link.member_label}</span>
                <small>
                  {link.revoked_at
                    ? "Revocado"
                    : link.last_used_at
                      ? `En uso · ${link.role}`
                      : `Sin usar · ${link.role}`}
                </small>
                {link.revoked_at ? null : (
                  <AccessLinkRevokeButton
                    officeId={membership.office_id}
                    linkId={link.id}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay enlaces todavía.</p>
        )}
      </div>
      <div className="panel">
        <h1>Invitar por correo</h1>
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
