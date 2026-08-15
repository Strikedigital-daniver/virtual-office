begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(18);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'offices', 'offices table exists');
select has_table('public', 'office_members', 'office_members table exists');
select has_table('public', 'office_invitations', 'office_invitations table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.offices'::regclass),
  'offices has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.office_members'::regclass),
  'office_members has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.office_invitations'::regclass),
  'office_invitations has RLS enabled'
);
select ok(
  has_table_privilege('service_role', 'public.office_invitations', 'select'),
  'service role can read invitations for server workflows'
);
select ok(
  has_table_privilege('service_role', 'public.office_invitations', 'insert'),
  'service role can create invitations'
);
select ok(
  has_table_privilege('service_role', 'public.office_invitations', 'update'),
  'service role can revoke invitations after mail errors'
);

insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('20000000-0000-4000-8000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'member-a@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000003', 'owner-b@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('20000000-0000-4000-8000-000000000004', 'invitee@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name)
values
  ('20000000-0000-4000-8000-000000000001', 'Owner A'),
  ('20000000-0000-4000-8000-000000000002', 'Member A'),
  ('20000000-0000-4000-8000-000000000003', 'Owner B');

insert into public.offices (id, slug, name, created_by)
values
  ('30000000-0000-4000-8000-000000000001', 'office-a', 'Office A', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', 'office-b', 'Office B', '20000000-0000-4000-8000-000000000003');

insert into public.office_members (office_id, user_id, role)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner'),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'owner');

insert into public.office_invitations (
  office_id, email, role, token_hash, expires_at, created_by
)
values (
  '30000000-0000-4000-8000-000000000001',
  'invitee@test.local',
  'member',
  encode(extensions.digest('test-invitation-token-with-at-least-43-characters-0001', 'sha256'), 'hex'),
  now() + interval '1 hour',
  '20000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000002","email":"member-a@test.local","role":"authenticated"}',
  true
);
select results_eq(
  $$select slug from public.offices order by slug$$,
  $$values ('office-a'::text)$$,
  'member sees only their active office'
);
select results_eq(
  $$select count(*)::bigint from public.offices where slug = 'office-b'$$,
  $$values (0::bigint)$$,
  'member cannot read another office'
);
select results_eq(
  $$select count(*)::bigint from public.office_invitations$$,
  $$values (0::bigint)$$,
  'ordinary member cannot read invitations'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000001","email":"owner-a@test.local","role":"authenticated"}',
  true
);
select results_eq(
  $$select count(*)::bigint from public.office_invitations$$,
  $$values (1::bigint)$$,
  'owner can read invitations for their office'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-4000-8000-000000000004","email":"invitee@test.local","role":"authenticated"}',
  true
);
select lives_ok(
  $$select * from public.accept_office_invitation('test-invitation-token-with-at-least-43-characters-0001', 'Invited Person')$$,
  'matching invited user can consume the invitation'
);
select results_eq(
  $$select count(*)::bigint from public.office_members where user_id = auth.uid() and active$$,
  $$values (1::bigint)$$,
  'acceptance creates one active membership'
);

reset role;
select ok(
  (select accepted_at is not null and accepted_by = '20000000-0000-4000-8000-000000000004'
   from public.office_invitations
   where email = 'invitee@test.local'),
  'consumed invitation is marked with the accepting user'
);

select * from finish();
rollback;
