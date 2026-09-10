import type { RealtimeResponse } from "@virtual-office/shared";

import { isRecoverableSfuError } from "./sfu-negotiation";

export class SubscribeResponseError extends Error {
  constructor(
    message: string,
    readonly code:
      "NO_MIDS" | "RENEGOTIATION_WITHOUT_SDP" | "NEGOTIATION_SKIPPED",
  ) {
    super(message);
    this.name = "SubscribeResponseError";
  }
}

export function midsFromSubscribeResponse(
  response: RealtimeResponse,
): string[] {
  return (response.tracks ?? [])
    .map((track) => track.mid)
    .filter((mid): mid is string => Boolean(mid));
}

export function subscribeNeedsNegotiation(response: RealtimeResponse): boolean {
  return (
    Boolean(response.sessionDescription) ||
    Boolean(response.requiresImmediateRenegotiation)
  );
}

export function assertValidSubscribeResponse(
  response: RealtimeResponse,
): string[] {
  const mids = midsFromSubscribeResponse(response);
  if (mids.length === 0) {
    throw new SubscribeResponseError(
      "SFU subscribe returned no track mids.",
      "NO_MIDS",
    );
  }
  if (response.requiresImmediateRenegotiation && !response.sessionDescription) {
    throw new SubscribeResponseError(
      "SFU requires renegotiation but omitted the session description.",
      "RENEGOTIATION_WITHOUT_SDP",
    );
  }
  if (!subscribeNeedsNegotiation(response)) {
    throw new SubscribeResponseError(
      "SFU returned track mids without a renegotiation offer.",
      "NEGOTIATION_SKIPPED",
    );
  }
  return mids;
}

export function isRecoverableSubscribeError(error: unknown): boolean {
  if (error instanceof SubscribeResponseError) return true;
  return isRecoverableSfuError(error);
}

/** Recreating recv kills every working remote; only do it for a dead session. */
export function shouldRecreateRecvOnSubscribeError(error: unknown): boolean {
  if (error instanceof SubscribeResponseError && error.code === "NO_MIDS") {
    return false;
  }
  return isRecoverableSfuError(error);
}

export function partitionSubscribeRefs<T extends { kind: string }>(
  refs: T[],
): { audio: T[]; video: T[] } {
  return {
    audio: refs.filter((ref) => ref.kind === "audio"),
    video: refs.filter((ref) => ref.kind === "video"),
  };
}
