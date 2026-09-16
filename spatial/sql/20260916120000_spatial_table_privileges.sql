-- Explicit privileges for Spatial tables; RLS does not protect TRUNCATE.
-- Review-only: this file is NOT authorization to execute against Club Supabase.
-- Apply through the Club's reviewed migration process, never legacy db push.
-- Existing RLS policies remain the authority for client row access.

REVOKE ALL ON TABLE
  public.spatial_worlds,
  public.spatial_access_grants,
  public.spatial_desk_assignments,
  public.spatial_chat_channels,
  public.spatial_chat_channel_members,
  public.spatial_chat_messages,
  public.spatial_avatar_loadouts
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.spatial_worlds,
  public.spatial_access_grants,
  public.spatial_desk_assignments
TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.spatial_avatar_loadouts
TO authenticated;

-- Persistent chat is accessed only through server-side entitlement checks.
-- service_role bypasses RLS; its credentials must never reach a browser.
GRANT ALL ON TABLE
  public.spatial_worlds,
  public.spatial_access_grants,
  public.spatial_desk_assignments,
  public.spatial_chat_channels,
  public.spatial_chat_channel_members,
  public.spatial_chat_messages,
  public.spatial_avatar_loadouts
TO service_role;
