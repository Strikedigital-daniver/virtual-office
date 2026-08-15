begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

select has_table('public', 'office_access_links', 'office_access_links table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.office_access_links'::regclass),
  'office_access_links has RLS enabled'
);
select ok(
  has_table_privilege('service_role', 'public.office_access_links', 'select'),
  'service role can read access links for server workflows'
);
select ok(
  has_table_privilege('service_role', 'public.office_access_links', 'insert'),
  'service role can create access links'
);
select ok(
  has_table_privilege('service_role', 'public.office_access_links', 'update'),
  'service role can revoke access links'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.redeem_office_access_link(uuid, uuid, text)',
    'execute'
  ),
  'authenticated users cannot execute the redeem function'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.redeem_office_access_link(uuid, uuid, text)',
    'execute'
  ),
  'service role can execute the redeem function'
);

insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('21000000-0000-4000-8000-000000000001', 'link-owner-a@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('21000000-0000-4000-8000-000000000002', 'link-member-a@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('21000000-0000-4000-8000-000000000003', 'link-owner-b@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('21000000-0000-4000-8000-000000000004', 'link-friend@test.local', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name)
values
  ('21000000-0000-4000-8000-000000000001', 'Link Owner A'),
  ('21000000-0000-4000-8000-000000000002', 'Link Member A'),
  ('21000000-0000-4000-8000-000000000003', 'Link Owner B');

insert into public.offices (id, slug, name, created_by)
values
  ('31000000-0000-4000-8000-000000000001', 'link-office-a', 'Link Office A', '21000000-0000-4000-8000-000000000001'),
  ('31000000-0000-4000-8000-000000000002', 'link-office-b', 'Link Office B', '21000000-0000-4000-8000-000000000003');

insert into public.office_members (office_id, user_id, role)
values
  ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'owner'),
  ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'member'),
  ('31000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000003', 'owner');

insert into public.office_access_links (id, office_id, member_label, role, token_hash, created_by)
values
  (
    '41000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    'Amigo Uno',
    'member',
    encode(extensions.digest('test-access-link-token-with-at-least-43-characters-01', 'sha256'), 'hex'),
    '21000000-0000-4000-8000-000000000001'
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000001',
    'Amigo Dos',
    'member',
    encode(extensions.digest('test-access-link-token-with-at-least-43-characters-02', 'sha256'), 'hex'),
    '21000000-0000-4000-8000-000000000001'
  );

update public.office_access_links
set revoked_at = now()
where id = '41000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-4000-8000-000000000002","email":"link-member-a@test.local","role":"authenticated"}',
  true
);
select results_eq(
  $$select count(*)::bigint from public.office_access_links$$,
  $$values (0::bigint)$$,
  'ordinary member cannot read access links'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-4000-8000-000000000001","email":"link-owner-a@test.local","role":"authenticated"}',
  true
);
select results_eq(
  $$select count(*)::bigint from public.office_access_links$$,
  $$values (2::bigint)$$,
  'owner can read the access links of their office'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-4000-8000-000000000003","email":"link-owner-b@test.local","role":"authenticated"}',
  true
);
select results_eq(
  $$select count(*)::bigint from public.office_access_links$$,
  $$values (0::bigint)$$,
  'an owner of another office cannot read foreign access links'
);

reset role;
select lives_ok(
  $$select * from public.redeem_office_access_link(
    '41000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000004',
    'Amigo Uno'
  )$$,
  'an active link can be redeemed for a user'
);
select results_eq(
  $$select count(*)::bigint from public.office_members
    where user_id = '21000000-0000-4000-8000-000000000004' and active$$,
  $$values (1::bigint)$$,
  'redeeming creates one active membership'
);
select ok(
  (select user_id = '21000000-0000-4000-8000-000000000004' and last_used_at is not null
   from public.office_access_links
   where id = '41000000-0000-4000-8000-000000000001'),
  'a redeemed link records the user and last use'
);
select throws_ok(
  $$select * from public.redeem_office_access_link(
    '41000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000004',
    'Amigo Dos'
  )$$,
  '42501',
  'access link unavailable',
  'a revoked link cannot be redeemed'
);

select * from finish();
rollback;
