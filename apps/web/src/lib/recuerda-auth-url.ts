const DEFAULT_RECUERDA_APP_URL = "https://recuerda-app-alpha.vercel.app";

export function getRecuerdaAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_RECUERDA_APP_URL?.replace(
    /\/$/,
    "",
  );
  return configured || DEFAULT_RECUERDA_APP_URL;
}

export function getCanonicalPasswordRecoveryUrl(): string {
  return `${getRecuerdaAppUrl()}/recuperar`;
}
