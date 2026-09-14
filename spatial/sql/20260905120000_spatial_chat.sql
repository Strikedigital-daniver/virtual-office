-- Sprint 7: persistent spatial chat (Club Supabase).
-- Review-only until owner approves execution against wteymdgzlxrfulmoymlx.
-- Do NOT apply via legacy virtual-office/supabase migrations.

CREATE TABLE IF NOT EXISTS public.spatial_chat_channels (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES public.spatial_worlds (id) ON DELETE CASCADE,
  room_id text,
  zone_key text,
  channel_key text NOT NULL,
  channel_kind text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spatial_chat_channels_kind_check CHECK (
    channel_kind IN ('GENERAL', 'OFFICE', 'DIRECT', 'ZONE')
  ),
  CONSTRAINT spatial_chat_channels_key_check CHECK (
    channel_key ~ '^[a-z0-9:_-]+$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS spatial_chat_channels_world_key_unique
  ON public.spatial_chat_channels (world_id, channel_key);

CREATE TABLE IF NOT EXISTS public.spatial_chat_channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.spatial_chat_channels (id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spatial_chat_channel_members_unique
    UNIQUE (channel_id, auth_user_id)
);

CREATE INDEX IF NOT EXISTS spatial_chat_channel_members_user_idx
  ON public.spatial_chat_channel_members (auth_user_id);

CREATE TABLE IF NOT EXISTS public.spatial_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.spatial_chat_channels (id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  body text NOT NULL,
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT spatial_chat_messages_body_length_check CHECK (
    char_length(body) BETWEEN 1 AND 2000
  )
);

CREATE INDEX IF NOT EXISTS spatial_chat_messages_channel_created_idx
  ON public.spatial_chat_messages (channel_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS spatial_chat_messages_client_idempotency_idx
  ON public.spatial_chat_messages (author_user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE public.spatial_chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spatial_chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spatial_chat_messages ENABLE ROW LEVEL SECURITY;

-- V1 chat reads/writes go through server-side Spatial API after entitlement checks.
CREATE POLICY spatial_chat_channels_deny_client
  ON public.spatial_chat_channels
  FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY spatial_chat_channel_members_deny_client
  ON public.spatial_chat_channel_members
  FOR ALL
  TO authenticated
  USING (false);

CREATE POLICY spatial_chat_messages_deny_client
  ON public.spatial_chat_messages
  FOR ALL
  TO authenticated
  USING (false);

INSERT INTO public.spatial_chat_channels (
  id,
  world_id,
  room_id,
  channel_key,
  channel_kind,
  display_name
)
SELECT
  'a0000001-0000-4000-8000-000000000001'::uuid,
  sw.id,
  'temple-main',
  'temple-general',
  'GENERAL',
  '# general'
FROM public.spatial_worlds sw
WHERE sw.slug = 'temple'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.spatial_chat_channels (
  id,
  world_id,
  room_id,
  channel_key,
  channel_kind,
  display_name
)
SELECT
  'a0000001-0000-4000-8000-000000000002'::uuid,
  sw.id,
  'temple-main',
  'office',
  'OFFICE',
  '# oficina'
FROM public.spatial_worlds sw
WHERE sw.slug = 'temple'
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.spatial_chat_channels IS
  'Persistent Spatial chat channels (general, office, direct, future zone/event).';

COMMENT ON TABLE public.spatial_chat_messages IS
  'Persistent Spatial chat messages; canonical history for Temple chat V1.';
