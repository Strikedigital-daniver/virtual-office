-- Executed after the real versioned Spatial SQL, never against Club itself.
SELECT spatial_test.assert(
  (SELECT count(*) = 7 AND bool_and(c.relrowsecurity)
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname LIKE 'spatial_%' AND c.relkind = 'r'),
  'all seven Spatial tables exist and enable RLS'
);
SELECT spatial_test.assert(
  (SELECT count(*) = 1 FROM public.spatial_worlds
   WHERE id = 'a1000000-0000-4000-8000-000000000001' AND slug = 'temple'),
  'Temple seed has the stable world identity'
);

-- Privilege checks cover every operation, including operations not governed by RLS.
DO $$
DECLARE
  table_name text;
  privilege_name text;
  allowed boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'spatial_worlds', 'spatial_access_grants', 'spatial_desk_assignments',
    'spatial_chat_channels', 'spatial_chat_channel_members', 'spatial_chat_messages',
    'spatial_avatar_loadouts'
  ] LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      allowed :=
        (privilege_name = 'SELECT' AND table_name IN (
          'spatial_worlds', 'spatial_access_grants', 'spatial_desk_assignments',
          'spatial_avatar_loadouts'
        )) OR
        (table_name = 'spatial_avatar_loadouts' AND privilege_name IN ('INSERT', 'UPDATE'));
      PERFORM spatial_test.assert(
        has_table_privilege('authenticated', 'public.' || table_name, privilege_name) = allowed,
        format('authenticated %s on %s = %s', privilege_name, table_name, allowed)
      );
      PERFORM spatial_test.assert(
        NOT has_table_privilege('anon', 'public.' || table_name, privilege_name),
        format('anon has no %s on %s', privilege_name, table_name)
      );
      PERFORM spatial_test.assert(
        has_table_privilege('service_role', 'public.' || table_name, privilege_name),
        format('service_role has %s on %s', privilege_name, table_name)
      );
    END LOOP;
  END LOOP;
END $$;

SET LOCAL ROLE service_role;
INSERT INTO public.spatial_access_grants
  (id, auth_user_id, world_id, zone_key, grant_type, expires_at, revoked_at)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'office', 'OFFICE_COLLABORATOR', NULL, NULL),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
   'a1000000-0000-4000-8000-000000000001', 'office', 'OFFICE_COLLABORATOR', NULL, NULL),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'office', 'OFFICE_COLLABORATOR', now() - interval '1 day', now());

INSERT INTO public.spatial_desk_assignments
  (id, world_id, room_id, desk_id, auth_user_id)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'temple-main', 'desk-one', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
   'temple-main', 'desk-two', '10000000-0000-4000-8000-000000000002');

INSERT INTO public.spatial_avatar_loadouts (auth_user_id, appearance)
VALUES ('10000000-0000-4000-8000-000000000002', '{"testOwner":"B"}');

INSERT INTO public.spatial_chat_channels
  (id, world_id, channel_key, channel_kind, display_name)
VALUES ('40000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'dm:a:b', 'DIRECT', 'Test DM');
INSERT INTO public.spatial_chat_channel_members (channel_id, auth_user_id)
VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');
INSERT INTO public.spatial_chat_messages
  (id, channel_id, author_user_id, body, client_message_id)
VALUES
  ('50000000-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'General test message', 'request-one'),
  ('50000000-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'Office test message', 'request-one'),
  ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'Direct test message', 'request-two');

SELECT spatial_test.assert((SELECT count(*) = 3 FROM public.spatial_chat_messages),
  'server role can persist general, office and direct messages');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_chat_messages (channel_id, author_user_id, body, client_message_id)
  VALUES ('a0000001-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
    'Reused id in a different channel', 'request-one')
$q$, '23505', 'message retry ID cannot duplicate an author message across channels');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_chat_messages (channel_id, author_user_id, body)
  VALUES ('a0000001-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '')
$q$, '23514', 'empty chat message rejected');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_chat_messages (channel_id, author_user_id, body)
  VALUES ('a0000001-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', repeat('x', 2001))
$q$, '23514', 'oversized chat message rejected');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_chat_channel_members (channel_id, auth_user_id)
  VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')
$q$, '23505', 'direct channel membership cannot duplicate');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_access_grants (auth_user_id, world_id, zone_key, grant_type)
  VALUES ('10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
    'office', 'OFFICE_COLLABORATOR')
$q$, '23505', 'active access grant cannot duplicate');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_access_grants (auth_user_id, world_id, zone_key, grant_type)
  VALUES ('10000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001',
    'office', 'ADMIN')
$q$, '23514', 'unsupported grant type rejected');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_desk_assignments (world_id, room_id, desk_id, auth_user_id)
  VALUES ('a1000000-0000-4000-8000-000000000001', 'temple-main', 'desk-one',
    '10000000-0000-4000-8000-000000000003')
$q$, '23505', 'an occupied desk cannot have a second active owner');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_desk_assignments (world_id, room_id, desk_id, auth_user_id)
  VALUES ('a1000000-0000-4000-8000-000000000001', 'temple-main', 'desk-three',
    '10000000-0000-4000-8000-000000000001')
$q$, '23505', 'a user cannot own two active desks in the same room');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT spatial_test.assert((SELECT count(*) = 1 FROM public.spatial_worlds),
  'authenticated can read world catalog');
SELECT spatial_test.assert((SELECT count(*) = 2 FROM public.spatial_access_grants),
  'authenticated sees only own grant history, including revoked entries');
SELECT spatial_test.assert(
  NOT EXISTS (SELECT 1 FROM public.spatial_access_grants WHERE auth_user_id <> auth.uid()),
  'another user access grants are hidden');
SELECT spatial_test.assert((SELECT count(*) = 2 FROM public.spatial_desk_assignments),
  'authenticated sees desk presence according to current catalog policy');

SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_access_grants (auth_user_id, world_id, zone_key, grant_type)
  VALUES ('10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
    'cowork', 'OFFICE_COLLABORATOR')
$q$, '42501', 'client cannot issue own access grants');
SELECT spatial_test.throws('UPDATE public.spatial_access_grants SET revoked_at = NULL',
  '42501', 'client cannot reactivate grants');
SELECT spatial_test.throws('DELETE FROM public.spatial_desk_assignments',
  '42501', 'client cannot clear desk ownership');
SELECT spatial_test.throws('TRUNCATE public.spatial_chat_messages',
  '42501', 'client cannot bypass RLS by truncating chat');
SELECT spatial_test.throws('SELECT * FROM public.spatial_chat_messages',
  '42501', 'client cannot read chat directly, including their own DM');

INSERT INTO public.spatial_avatar_loadouts (auth_user_id, appearance)
VALUES (auth.uid(), '{"testOwner":"A"}');
SELECT spatial_test.assert((SELECT count(*) = 1 FROM public.spatial_avatar_loadouts),
  'avatar owner can insert and read only their own row');
UPDATE public.spatial_avatar_loadouts SET appearance = '{"testOwner":"A","changed":true}'
WHERE auth_user_id = auth.uid();
SELECT spatial_test.assert(
  (SELECT appearance ->> 'changed' = 'true' FROM public.spatial_avatar_loadouts),
  'avatar owner update persists');
WITH changed AS (
  UPDATE public.spatial_avatar_loadouts SET appearance = '{"attacker":true}'
  WHERE auth_user_id = '10000000-0000-4000-8000-000000000002' RETURNING auth_user_id
)
SELECT spatial_test.assert((SELECT count(*) = 0 FROM changed),
  'updating another avatar affects zero rows');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_avatar_loadouts (auth_user_id, appearance)
  VALUES ('10000000-0000-4000-8000-000000000003', '{}')
$q$, '42501', 'client cannot insert an avatar for another user');
SELECT spatial_test.throws($q$
  UPDATE public.spatial_avatar_loadouts SET auth_user_id = '10000000-0000-4000-8000-000000000003'
  WHERE auth_user_id = auth.uid()
$q$, '42501', 'avatar owner cannot transfer row ownership');
SELECT spatial_test.throws('DELETE FROM public.spatial_avatar_loadouts WHERE auth_user_id = auth.uid()',
  '42501', 'client cannot delete avatar loadouts');
SELECT spatial_test.throws($q$
  UPDATE public.spatial_avatar_loadouts SET appearance = '[]' WHERE auth_user_id = auth.uid()
$q$, '23514', 'avatar appearance must be a JSON object');
SELECT spatial_test.throws($q$
  UPDATE public.spatial_avatar_loadouts SET appearance_version = 2 WHERE auth_user_id = auth.uid()
$q$, '23514', 'unsupported avatar version rejected');
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT spatial_test.assert(
  (SELECT count(*) = 1 AND bool_and(appearance ->> 'testOwner' = 'B') FROM public.spatial_avatar_loadouts),
  'second user retains independent unmodified avatar');
SELECT spatial_test.assert((SELECT count(*) = 1 FROM public.spatial_access_grants),
  'second user sees their own grant only');
SELECT set_config('request.jwt.claims', '{}', true);
SELECT spatial_test.assert((SELECT count(*) = 0 FROM public.spatial_avatar_loadouts),
  'missing user claim cannot read avatar rows');
SELECT spatial_test.assert((SELECT count(*) = 0 FROM public.spatial_access_grants),
  'missing user claim cannot read grants');
RESET ROLE;

-- Defense in depth: temporarily allow SQL verbs inside this rolled-back test
-- and prove the historical chat policies still deny rows/writes via RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.spatial_chat_channels, public.spatial_chat_channel_members, public.spatial_chat_messages
TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT spatial_test.assert((SELECT count(*) = 0 FROM public.spatial_chat_channels),
  'chat channel RLS denies direct client reads even with SELECT privilege');
SELECT spatial_test.assert((SELECT count(*) = 0 FROM public.spatial_chat_channel_members),
  'chat membership RLS hides even the caller DM membership');
SELECT spatial_test.assert((SELECT count(*) = 0 FROM public.spatial_chat_messages),
  'chat message RLS hides all channels from direct clients');
SELECT spatial_test.throws($q$
  INSERT INTO public.spatial_chat_messages (channel_id, author_user_id, body)
  VALUES ('40000000-0000-4000-8000-000000000001', auth.uid(), 'Direct client injection')
$q$, '42501', 'chat RLS rejects writes even by a direct-channel member');
WITH changed AS (UPDATE public.spatial_chat_messages SET body = 'tampered' RETURNING id)
SELECT spatial_test.assert((SELECT count(*) = 0 FROM changed), 'chat RLS prevents client updates');
WITH removed AS (DELETE FROM public.spatial_chat_messages RETURNING id)
SELECT spatial_test.assert((SELECT count(*) = 0 FROM removed), 'chat RLS prevents client deletes');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT spatial_test.throws('SELECT * FROM public.spatial_worlds', '42501', 'anonymous catalog denied');
SELECT spatial_test.throws('SELECT * FROM public.spatial_avatar_loadouts', '42501', 'anonymous avatars denied');
SELECT spatial_test.throws('TRUNCATE public.spatial_chat_messages', '42501', 'anonymous truncate denied');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT spatial_test.assert((SELECT count(*) = 3 FROM public.spatial_chat_messages),
  'failed client mutations leave server-side chat history intact');
UPDATE public.spatial_desk_assignments SET revoked_at = now()
WHERE id = '30000000-0000-4000-8000-000000000001';
INSERT INTO public.spatial_desk_assignments (world_id, room_id, desk_id, auth_user_id)
VALUES ('a1000000-0000-4000-8000-000000000001', 'temple-main', 'desk-one',
  '10000000-0000-4000-8000-000000000003');
SELECT spatial_test.assert(
  (SELECT count(*) = 1 FROM public.spatial_desk_assignments WHERE desk_id = 'desk-one' AND revoked_at IS NULL),
  'revoked desk can be reassigned without losing its history');
UPDATE public.spatial_access_grants SET revoked_at = now()
WHERE id = '20000000-0000-4000-8000-000000000001';
INSERT INTO public.spatial_access_grants (auth_user_id, world_id, zone_key, grant_type)
VALUES ('10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
  'office', 'OFFICE_COLLABORATOR');
SELECT spatial_test.assert(
  (SELECT count(*) = 1 FROM public.spatial_access_grants
   WHERE auth_user_id = '10000000-0000-4000-8000-000000000001' AND revoked_at IS NULL),
  'revoked grant can be reissued without duplicating active authorization');
RESET ROLE;
