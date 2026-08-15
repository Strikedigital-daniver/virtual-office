-- The server-only Supabase client uses the service_role database role.
-- RLS bypass does not replace ordinary table privileges, so grant only the
-- operations required to create invitations and revoke them after mail errors.
grant select, insert, update
on table public.office_invitations
to service_role;
