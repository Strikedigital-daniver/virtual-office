-- Read-only-intent RLS probe for spatial_avatar_loadouts.
-- Uses two existing auth.users ids. Inserts probe rows then deletes them.
-- Does not modify Club profile/membership tables.

DO $$
DECLARE
  user_a uuid;
  user_b uuid;
  seen int;
BEGIN
  SELECT id INTO user_a FROM auth.users ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO user_b FROM auth.users WHERE id <> user_a ORDER BY created_at DESC LIMIT 1;
  IF user_a IS NULL OR user_b IS NULL THEN
    RAISE EXCEPTION 'RLS probe needs two auth.users rows';
  END IF;

  DELETE FROM public.spatial_avatar_loadouts
  WHERE appearance ? 'rlsProbe';

  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO public.spatial_avatar_loadouts (
    auth_user_id,
    appearance_version,
    appearance
  ) VALUES (
    user_a,
    1,
    jsonb_build_object('rlsProbe', true, 'owner', 'a')
  );

  SELECT count(*) INTO seen
  FROM public.spatial_avatar_loadouts
  WHERE auth_user_id = user_a;
  IF seen <> 1 THEN
    RAISE EXCEPTION 'authenticated A SELECT own failed (count=%)', seen;
  END IF;

  UPDATE public.spatial_avatar_loadouts
  SET appearance = appearance || jsonb_build_object('updated', true)
  WHERE auth_user_id = user_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authenticated A UPDATE own failed';
  END IF;

  SELECT count(*) INTO seen
  FROM public.spatial_avatar_loadouts
  WHERE auth_user_id = user_b;
  IF seen <> 0 THEN
    RAISE EXCEPTION 'authenticated A SELECT B should be empty';
  END IF;

  UPDATE public.spatial_avatar_loadouts
  SET appearance = appearance || jsonb_build_object('hacked', true)
  WHERE auth_user_id = user_b;
  IF FOUND THEN
    RAISE EXCEPTION 'authenticated A UPDATE B should not find a row';
  END IF;

  BEGIN
    INSERT INTO public.spatial_avatar_loadouts (
      auth_user_id,
      appearance_version,
      appearance
    ) VALUES (
      user_b,
      1,
      jsonb_build_object('rlsProbe', true, 'owner', 'b-from-a')
    );
    RAISE EXCEPTION 'authenticated A INSERT B should be denied';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      NULL;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM 1 FROM public.spatial_avatar_loadouts;
      RAISE EXCEPTION 'anon SELECT should be denied by privilege or RLS';
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
    EXECUTE 'RESET ROLE';
  END;

  DELETE FROM public.spatial_avatar_loadouts
  WHERE appearance ? 'rlsProbe';
END $$;

SELECT 'rls_probe_ok' AS result;
