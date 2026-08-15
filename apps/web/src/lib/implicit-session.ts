export function parseImplicitSessionHash(hash: string) {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = parameters.get("access_token");
  const refreshToken = parameters.get("refresh_token");

  return accessToken && refreshToken
    ? { access_token: accessToken, refresh_token: refreshToken }
    : null;
}
