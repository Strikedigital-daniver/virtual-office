-- pgTAP detectó (CI run #2) que accept_office_invitation falla con
-- 42702 "column reference office_id is ambiguous": el ON CONFLICT
-- (office_id, user_id) colisiona con la columna de retorno office_id.
-- Se re-crea la función con #variable_conflict use_column; ninguna
-- variable de la función comparte nombre con columnas de las tablas
-- involucradas, por lo que la directiva es segura.

create or replace function public.accept_office_invitation(invite_token text, chosen_display_name text)
returns table (office_id uuid, office_slug text, member_role public.office_role)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
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
