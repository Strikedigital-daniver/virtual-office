-- Sprint 3.5C — Spatial Platform: registro mínimo de mundo Temple.
-- Ownership canónico futuro: migración equivalente en recuerda-app.
-- Office es zona dentro del mapa Temple, no fila en esta tabla.
-- Audionautica: migración versionada separada cuando abra su vertical slice.

CREATE TABLE IF NOT EXISTS public.spatial_worlds (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spatial_worlds_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT spatial_worlds_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE public.spatial_worlds IS
  'Stable realtime world IDs. One Durable Object namespace per world UUID. '
  'Temple map includes Office as an access-controlled zone (not a world row).';

INSERT INTO public.spatial_worlds (id, slug, display_name)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'temple',
  'Templo'
)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.spatial_worlds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spatial_worlds_read_authenticated ON public.spatial_worlds;

CREATE POLICY spatial_worlds_read_authenticated
  ON public.spatial_worlds
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.spatial_worlds FROM anon;
GRANT SELECT ON public.spatial_worlds TO authenticated;

-- No INSERT/UPDATE/DELETE for authenticated in 3.5C.
-- Future writes: service_role or staff-only RPC in recuerda-app.
