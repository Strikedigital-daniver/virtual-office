export function describeSessionDescription(
  description: RTCSessionDescription | RTCSessionDescriptionInit | null,
): { sdp: string; type: "offer" | "answer" } {
  if (!description?.sdp || !description.type) {
    throw new Error("WebRTC did not produce an SDP description");
  }
  if (description.type !== "offer" && description.type !== "answer") {
    throw new Error(`Unsupported SDP type: ${description.type}`);
  }
  return { sdp: description.sdp, type: description.type };
}

export function shouldRollbackBeforeRemoteOffer(
  signalingState: RTCSignalingState,
  remoteType: RTCSdpType,
): boolean {
  return remoteType === "offer" && signalingState === "have-local-offer";
}

/**
 * Cloudflare Realtime does not trickle ICE. Send SDP only after gathering
 * finishes so the offer/answer includes candidates.
 */
export function waitForIceGathering(
  peerConnection: RTCPeerConnection,
  timeoutMs = 2_500,
): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peerConnection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peerConnection.iceGatheringState === "complete") finish();
    };
    peerConnection.addEventListener("icegatheringstatechange", onChange);
    const timer = setTimeout(finish, timeoutMs);
  });
}

export function selectVp8SendCodecs<T extends { mimeType: string }>(
  codecs: T[],
): T[] {
  return codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/vp8");
}

export function preferVp8SendCodec(transceiver: RTCRtpTransceiver): void {
  const capabilities = RTCRtpSender.getCapabilities?.("video");
  if (!capabilities?.codecs.length) return;
  const preferred = selectVp8SendCodecs(capabilities.codecs);
  if (preferred.length === 0) return;
  try {
    transceiver.setCodecPreferences(preferred);
  } catch {
    // Firefox may reject preference lists that omit bundled RTX.
  }
}

export function isPeerTransportConnected(
  peerConnection: RTCPeerConnection,
): boolean {
  const ice = peerConnection.iceConnectionState;
  const conn = peerConnection.connectionState;
  return conn === "connected" || ice === "connected" || ice === "completed";
}

export function waitForPeerTransport(
  peerConnection: RTCPeerConnection,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  if (isPeerTransportConnected(peerConnection)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${label} peer ICE did not connect in time`));
    }, timeoutMs);

    const check = () => {
      if (isPeerTransportConnected(peerConnection)) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
        return;
      }
      if (
        peerConnection.iceConnectionState === "failed" ||
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new Error(
            `${label} peer transport ${peerConnection.iceConnectionState}/${peerConnection.connectionState}`,
          ),
        );
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      peerConnection.removeEventListener("iceconnectionstatechange", check);
      peerConnection.removeEventListener("connectionstatechange", check);
    };

    peerConnection.addEventListener("iceconnectionstatechange", check);
    peerConnection.addEventListener("connectionstatechange", check);
    check();
  });
}

export function isRecoverableSfuError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\(410\)/u.test(message) ||
    /peer ICE did not connect/i.test(message) ||
    /peer transport failed/i.test(message) ||
    /transceiver type does not match/iu.test(message) ||
    /failed to set local offer sdp/iu.test(message) ||
    /setLocalDescription/iu.test(message)
  );
}

export async function rollbackLocalOffer(
  peerConnection: RTCPeerConnection,
): Promise<void> {
  if (peerConnection.signalingState !== "have-local-offer") return;
  try {
    await peerConnection.setLocalDescription({ type: "rollback" });
  } catch {
    // Safari and some Chromium builds reject explicit rollback.
  }
}

export async function applySfuNegotiation(
  peerConnection: RTCPeerConnection,
  remote: RTCSessionDescriptionInit,
  sendAnswer: (description: {
    sdp: string;
    type: "offer" | "answer";
  }) => Promise<void>,
): Promise<void> {
  if (!remote.sdp || (remote.type !== "offer" && remote.type !== "answer")) {
    throw new Error("Realtime omitted the session description");
  }

  if (remote.type === "offer") {
    if (
      shouldRollbackBeforeRemoteOffer(peerConnection.signalingState, "offer")
    ) {
      await rollbackLocalOffer(peerConnection);
    }
    await peerConnection.setRemoteDescription(remote);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    // Match the proven sprint-0 client: send the answer immediately. Waiting
    // on iceGatheringState with a timeout produced incomplete SDPs and
    // one-way audio (local ICE connected, remote subscribe got no mids).
    await sendAnswer(
      describeSessionDescription(peerConnection.localDescription),
    );
    return;
  }

  if (peerConnection.signalingState !== "have-local-offer") {
    throw new Error(
      `No se puede aplicar la respuesta SFU en estado ${peerConnection.signalingState}.`,
    );
  }
  await peerConnection.setRemoteDescription(remote);
}
