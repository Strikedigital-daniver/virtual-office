"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface AccessLinkRevokeButtonProps {
  officeId: string;
  linkId: string;
}

export function AccessLinkRevokeButton({
  officeId,
  linkId,
}: AccessLinkRevokeButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function revoke() {
    setSubmitting(true);
    await fetch("/api/admin/access-links/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId, linkId }),
    });
    router.refresh();
  }

  return (
    <button type="button" onClick={revoke} disabled={submitting}>
      {submitting ? "Revocando…" : "Revocar"}
    </button>
  );
}
