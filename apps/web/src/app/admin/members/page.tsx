import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UserCreateForm } from "@/components/user-create-form";
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
        <p>Solo owner y administradores pueden crear usuarios.</p>
        <a href="/">Volver a la oficina</a>
      </section>
    );
  }

  const { data: office } = await supabase
    .from("offices")
    .select("name")
    .eq("id", membership.office_id)
    .single();
  const { data: members } = await supabase
    .from("office_members")
    .select("user_id, role, active")
    .eq("office_id", membership.office_id)
    .order("joined_at", { ascending: true });
  const memberIds = (members ?? []).map((member) => member.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", memberIds)
    : { data: [] };
  const nameById = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.display_name]),
  );

  return (
    <section className="admin-grid">
      <div className="panel">
        <p className="eyebrow">{office?.name ?? "Oficina"}</p>
        <h1>Crear usuario</h1>
        <p>
          Define su nombre de usuario y contraseña, y comunícaselos tú
          directamente. Con eso ya puede entrar.
        </p>
        <UserCreateForm officeId={membership.office_id} />
      </div>
      <div className="panel">
        <h2>Miembros</h2>
        {members?.length ? (
          <ul className="invitation-list">
            {members.map((member) => (
              <li key={member.user_id}>
                <span>{nameById.get(member.user_id) ?? "Sin perfil"}</span>
                <small>
                  {member.active ? member.role : `${member.role} · inactivo`}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>No hay miembros todavía.</p>
        )}
      </div>
    </section>
  );
}
