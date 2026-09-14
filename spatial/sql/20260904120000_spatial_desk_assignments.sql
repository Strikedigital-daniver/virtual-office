-- Sprint 5.1: persistent desk assignments (map placement stays in RoomDefinition).
-- Review-only until owner approves execution against Club Supabase.
-- Do NOT apply via legacy virtual-office/supabase migrations.

CREATE TABLE IF NOT EXISTS public.spatial_desk_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES public.spatial_worlds (id) ON DELETE CASCADE,
  room_id text NOT NULL,
  desk_id text NOT NULL,
  auth_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT spatial_desk_assignments_room_id_check CHECK (
    room_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT spatial_desk_assignments_desk_id_check CHECK (
    desk_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS spatial_desk_assignments_active_unique
  ON public.spatial_desk_assignments (world_id, room_id, desk_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS spatial_desk_assignments_user_active_unique
  ON public.spatial_desk_assignments (world_id, room_id, auth_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS spatial_desk_assignments_auth_user_idx
  ON public.spatial_desk_assignments (auth_user_id);

ALTER TABLE public.spatial_desk_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY spatial_desk_assignments_select_authenticated
  ON public.spatial_desk_assignments
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.spatial_desk_assignments IS
  'Persistent desk ownership/preferences. Desk geometry lives in published room maps.';
