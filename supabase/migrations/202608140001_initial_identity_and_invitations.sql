create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create type public.office_role as enum ('owner', 'admin', 'member', 'freelancer');
create type public.presence_status as enum ('available', 'busy', 'focus', 'away');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  max_members smallint not null default 7 check (max_members between 1 and 7),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.office_members (
  office_id uuid not null references public.offices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.office_role not null,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (office_id, user_id)
);

create table public.office_invitations (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  role public.office_role not null check (role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((accepted_at is null) = (accepted_by is null))
);

create index office_members_user_active_idx
  on public.office_members (user_id, office_id)
  where active;
create index office_invitations_office_created_idx
  on public.office_invitations (office_id, created_at desc);
create index office_invitations_email_pending_idx
  on public.office_invitations (email, expires_at)
  where accepted_at is null and revoked_at is null;

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create function private.is_active_office_member(target_office_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.office_members
    where office_id = target_office_id
      and user_id = target_user_id
      and active
  );
$$;

create function private.has_office_role(target_office_id uuid, allowed_roles public.office_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.office_members
    where office_id = target_office_id
      and user_id = auth.uid()
      and active
      and role = any(allowed_roles)
  );
$$;

create function private.shares_active_office(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.office_members mine
    join public.office_members theirs on theirs.office_id = mine.office_id
    where mine.user_id = auth.uid()
      and mine.active
      and theirs.user_id = target_user_id
      and theirs.active
  );
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.is_active_office_member(uuid, uuid) from public, anon, authenticated;
revoke all on function private.has_office_role(uuid, public.office_role[]) from public, anon, authenticated;
revoke all on function private.shares_active_office(uuid) from public, anon, authenticated;
grant execute on function private.is_active_office_member(uuid, uuid) to authenticated;
grant execute on function private.has_office_role(uuid, public.office_role[]) to authenticated;
grant execute on function private.shares_active_office(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.offices enable row level security;
alter table public.office_members enable row level security;
alter table public.office_invitations enable row level security;

create policy profiles_read_same_office
on public.profiles for select to authenticated
using (id = auth.uid() or (select private.shares_active_office(id)));

create policy profiles_update_self
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy offices_read_active_members
on public.offices for select to authenticated
using ((select private.is_active_office_member(id)));

create policy memberships_read_active_office
on public.office_members for select to authenticated
using ((select private.is_active_office_member(office_id)));

create policy invitations_read_admins
on public.office_invitations for select to authenticated
using (
  (select private.has_office_role(
    office_id,
    array['owner', 'admin']::public.office_role[]
  ))
);

revoke all on public.profiles, public.offices, public.office_members, public.office_invitations
from anon, authenticated;
grant select on public.profiles, public.offices, public.office_members, public.office_invitations
to authenticated;
grant update (display_name, avatar_config) on public.profiles to authenticated;

create function public.accept_office_invitation(invite_token text, chosen_display_name text)
returns table (office_id uuid, office_slug text, member_role public.office_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation public.office_invitations%rowtype;
  capacity smallint;
  active_members integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if char_length(btrim(chosen_display_name)) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'invalid display name';
  end if;

  select lower(email) into current_email from auth.users where id = current_user_id;
  if current_email is null then
    raise exception using errcode = '42501', message = 'verified email required';
  end if;

  select * into invitation
  from public.office_invitations
  where token_hash = encode(extensions.digest(invite_token, 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and email = current_email
  for update;
  if invitation.id is null then
    raise exception using errcode = '42501', message = 'invitation unavailable';
  end if;

  select max_members into capacity from public.offices where id = invitation.office_id for update;
  select count(*) into active_members
  from public.office_members
  where public.office_members.office_id = invitation.office_id and active;
  if active_members >= capacity
    and not exists (
      select 1 from public.office_members
      where public.office_members.office_id = invitation.office_id
        and user_id = current_user_id
        and active
    ) then
    raise exception using errcode = '23514', message = 'office capacity reached';
  end if;

  insert into public.profiles (id, display_name)
  values (current_user_id, btrim(chosen_display_name))
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.office_members (office_id, user_id, role, active)
  values (invitation.office_id, current_user_id, invitation.role, true)
  on conflict (office_id, user_id) do update
    set active = true,
        role = case
          when public.office_members.role = 'owner' then 'owner'::public.office_role
          else excluded.role
        end;

  update public.office_invitations
  set accepted_at = now(), accepted_by = current_user_id
  where id = invitation.id;

  return query
  select offices.id, offices.slug, invitation.role
  from public.offices as offices
  where offices.id = invitation.office_id;
end;
$$;

revoke all on function public.accept_office_invitation(text, text) from public, anon;
grant execute on function public.accept_office_invitation(text, text) to authenticated;

comment on function public.accept_office_invitation(text, text) is
  'Consumes one unexpired invitation whose email matches the authenticated user; only a SHA-256 token hash is stored.';
