const USERNAME_DOMAIN = "mhcave.invalid";

export function usernameToEmail(username: string): string | null {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9]{2,20}$/.test(normalized)) return null;
  return `${normalized}@${USERNAME_DOMAIN}`;
}
