import { redirect } from "next/navigation";

import { getCanonicalPasswordRecoveryUrl } from "@/lib/recuerda-auth-url";

export const dynamic = "force-dynamic";

export default function RecuperarCompatRedirectPage() {
  redirect(getCanonicalPasswordRecoveryUrl());
}
