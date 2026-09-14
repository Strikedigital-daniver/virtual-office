-- Sprint 5: explicit spatial access grants (Office collaborators).
-- Review-only until owner approves execution against Club Supabase.
-- Do NOT apply via legacy virtual-office/supabase migrations.

CREATE TABLE IF NOT EXISTS public.spatial_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES public.spatial_worlds (id) ON DELETE CASCADE,
  zone_key text NOT NULL,
  grant_type text NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spatial_access_grants_zone_key_check CHECK (
    zone_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT spatial_access_grants_grant_type_check CHECK (
    grant_type IN ('OFFICE_COLLABORATOR')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS spatial_access_grants_active_unique
  ON public.spatial_access_grants (auth_user_id, world_id, zone_key, grant_type)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS spatial_access_grants_auth_user_idx
  ON public.spatial_access_grants (auth_user_id);

ALTER TABLE public.spatial_access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY spatial_access_grants_select_own
  ON public.spatial_access_grants
  FOR SELECT
  TO authenticated
  USING (auth.uid() = auth_user_id);

COMMENT ON TABLE public.spatial_access_grants IS
  'Explicit non-Club spatial zone access (e.g. Office collaborators).';
