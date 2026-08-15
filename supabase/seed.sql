-- Deterministic local-only data. This user has no password and cannot sign in;
-- create an invited login through local Studio/Mailpit for manual browser testing.
insert into auth.users (
  id,
  email,
  aud,
  role,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  'owner@mhcave.local',
  'authenticated',
  'authenticated',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values ('00000000-0000-4000-8000-000000000001', 'Owner local')
on conflict (id) do nothing;

insert into public.offices (id, slug, name, created_by)
values (
  '10000000-0000-4000-8000-000000000001',
  'mhcave',
  'mhcave',
  '00000000-0000-4000-8000-000000000001'
)
on conflict (id) do nothing;

insert into public.office_members (office_id, user_id, role)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'owner'
)
on conflict (office_id, user_id) do nothing;
