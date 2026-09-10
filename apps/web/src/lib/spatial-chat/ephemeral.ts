/** Chat temporal en memoria (sin tablas spatial_chat en Supabase). */
export function isSpatialChatEphemeral(): boolean {
  const explicit = process.env.SPATIAL_CHAT_EPHEMERAL?.trim().toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "off") {
    return false;
  }
  if (explicit === "1" || explicit === "true" || explicit === "on") {
    return true;
  }
  return process.env.NODE_ENV === "development";
}
