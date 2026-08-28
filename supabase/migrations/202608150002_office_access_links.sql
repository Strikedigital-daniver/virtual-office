create table public.office_access_links (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  member_label text not null check (char_length(btrim(member_label)) between 1 and 40),
  email text check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  role public.office_role not null check (role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index office_access_links_office_created_idx
  on public.office_access_links (office_id, created_at desc);

alter table public.office_access_links enable row level security;

create policy access_links_read_admins
on public.office_access_links for select to authenticated
using (
  (select private.has_office_role(
    office_id,
    array['owner', 'admin']::public.office_role[]
  ))
);

revoke all on public.office_access_links from anon, authenticated;
grant select on public.office_access_links to authenticated;

-- The server-only Supabase client uses the service_role database role.
-- RLS bypass does not replace ordinary table privileges, so grant only the
-- operations the link workflows need: lookup, creation and revocation.
grant select, insert, update
on table public.office_access_links
to service_role;

create function public.redeem_office_access_link(
  link_id uuid,
  target_user_id uuid,
  chosen_display_name text
)
returns table (office_id uuid, office_slug text, member_role public.office_role)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  link public.office_access_links%rowtype;
  capacity smallint;
  active_members integer;
begin
  if char_length(btrim(chosen_display_name)) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'invalid display name';
  end if;

  select * into link
  from public.office_access_links
  where id = link_id
    and revoked_at is null
    and (user_id is null or user_id = target_user_id)
  for update;
  if link.id is null then
    raise exception using errcode = '42501', message = 'access link unavailable';
  end if;

  select max_members into capacity from public.offices where id = link.office_id for update;
  select count(*) into active_members
  from public.office_members
  where public.office_members.office_id = link.office_id and active;
  if active_members >= capacity
    and not exists (
      select 1 from public.office_members
      where public.office_members.office_id = link.office_id
        and user_id = target_user_id
        and active
    ) then
    raise exception using errcode = '23514', message = 'office capacity reached';
  end if;

  insert into public.profiles (id, display_name)
  values (target_user_id, btrim(chosen_display_name))
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.office_members (office_id, user_id, role, active)
  values (link.office_id, target_user_id, link.role, true)
  on conflict (office_id, user_id) do update
    set active = true,
        role = case
          when public.office_members.role = 'owner' then 'owner'::public.office_role
          else excluded.role
        end;

  update public.office_access_links
  set user_id = target_user_id, last_used_at = now()
  where id = link.id;

  return query
  select offices.id, offices.slug, link.role
  from public.offices as offices
  where offices.id = link.office_id;
end;
$$;

revoke all on function public.redeem_office_access_link(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_office_access_link(uuid, uuid, text) to service_role;

comment on table public.office_access_links is
  'Personal, revocable join links (ADR-009); only a SHA-256 token hash is stored.';
comment on function public.redeem_office_access_link(uuid, uuid, text) is
  'Redeems a personal access link for a user; service-role only, capacity-checked.';
