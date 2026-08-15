export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://virtual-office.invalid");
    return url.origin === "https://virtual-office.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export function safeSameOriginRedirect(
  value: string | null | undefined,
  origin: string,
  fallback = "/",
): string {
  if (!value) return fallback;
  try {
    const url = new URL(value, origin);
    return url.origin === origin
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
