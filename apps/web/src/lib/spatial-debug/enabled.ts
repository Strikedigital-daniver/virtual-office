/** Staging/dev-only spatial diagnostics (?spatialDebug=1). */
export function spatialDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_APP_ENV === "staging") return true;
  if (process.env.NODE_ENV === "development") return true;
  return new URLSearchParams(window.location.search).has("spatialDebug");
}

export function shortId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length <= 8 ? value : value.slice(0, 8);
}
