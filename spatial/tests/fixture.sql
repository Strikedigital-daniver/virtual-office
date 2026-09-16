-- Test-only minimal auth contract. This is not the Recuerda Club schema.
-- Everything, including roles, is rolled back by the harness transaction.
DO $$
BEGIN
  IF current_database() <> 'spatial_contract_test' THEN
    RAISE EXCEPTION 'Refusing non-test database: %', current_database();
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  ) OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 'spatial_test')) THEN
    RAISE EXCEPTION 'Fixture requires an empty disposable database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) THEN
    RAISE EXCEPTION 'Fixture requires a disposable PostgreSQL cluster without Supabase roles';
  END IF;
END $$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Deliberately permissive baseline exercises the explicit revokes. Without
-- hardening, TRUNCATE bypasses RLS even when no INSERT/UPDATE policy exists.
-- This is a test assumption, not evidence of the live Club's ACL configuration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE SCHEMA spatial_test;
GRANT USAGE ON SCHEMA spatial_test TO anon, authenticated, service_role;
CREATE FUNCTION spatial_test.assert(condition boolean, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

CREATE FUNCTION spatial_test.throws(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  actual_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
  END;
  PERFORM spatial_test.assert(actual_state = expected_state, label || ' (SQLSTATE)');
END $$;

INSERT INTO auth.users (id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
