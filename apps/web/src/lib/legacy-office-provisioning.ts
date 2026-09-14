import { NextResponse } from "next/server";

export const LEGACY_OFFICE_PROVISIONING_DISABLED = true;

export const LEGACY_OFFICE_DISABLED_MESSAGE =
  "Provisioning temporal de oficina deshabilitado en integración Club.";

export function legacyOfficeProvisioningBlocked(): NextResponse {
  return NextResponse.json(
    { error: LEGACY_OFFICE_DISABLED_MESSAGE },
    { status: 410 },
  );
}
