const SYNTHETIC_EMAIL_DOMAIN = "members.virtual-office.invalid";

export function syntheticAccessLinkEmail(linkId: string): string {
  return `link-${linkId}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function resolveAccessLinkEmail(
  linkId: string,
  storedEmail: string | null,
): string {
  return storedEmail ?? syntheticAccessLinkEmail(linkId);
}

export function buildJoinUrl(origin: string, token: string): string {
  return `${origin}/join/${token}`;
}
