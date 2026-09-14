-- Sprint 7.2: Spatial avatar loadouts (Club Supabase).
-- Isolated SQL. Do NOT apply via legacy virtual-office/supabase migrations.
-- Target project: wteymdgzlxrfulmoymlx
-- Touches ONLY public.spatial_avatar_loadouts.

CREATE TABLE IF NOT EXISTS public.spatial_avatar_loadouts (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  appearance_version integer NOT NULL DEFAULT 1,
  appearance jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spatial_avatar_loadouts_version_check CHECK (appearance_version = 1),
  CONSTRAINT spatial_avatar_loadouts_appearance_object CHECK (
    jsonb_typeof(appearance) = 'object'
  )
);

ALTER TABLE public.spatial_avatar_loadouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY spatial_avatar_loadouts_select_own
  ON public.spatial_avatar_loadouts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = auth_user_id);

CREATE POLICY spatial_avatar_loadouts_insert_own
  ON public.spatial_avatar_loadouts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = auth_user_id);

CREATE POLICY spatial_avatar_loadouts_update_own
  ON public.spatial_avatar_loadouts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

COMMENT ON TABLE public.spatial_avatar_loadouts IS
  'One active Spatial avatar loadout per auth user. No Club profile required.';

GRANT SELECT, INSERT, UPDATE ON TABLE public.spatial_avatar_loadouts TO authenticated;
GRANT ALL ON TABLE public.spatial_avatar_loadouts TO service_role;
REVOKE ALL ON TABLE public.spatial_avatar_loadouts FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.spatial_avatar_loadouts FROM authenticated;
