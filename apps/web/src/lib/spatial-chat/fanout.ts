import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SpatialChatMessageCreatedEvent } from "@virtual-office/shared";

function sharedSecret(): string | null {
  try {
    const fromWorker = (
      getCloudflareContext({ async: false }).env as {
        REALTIME_WORKER_SHARED_SECRET?: string;
      }
    ).REALTIME_WORKER_SHARED_SECRET;
    if (typeof fromWorker === "string" && fromWorker.trim()) {
      return fromWorker;
    }
  } catch {
    // Local dev / tests outside the Cloudflare worker.
  }
  const fromProcess = process.env.REALTIME_WORKER_SHARED_SECRET;
  return typeof fromProcess === "string" && fromProcess.trim()
    ? fromProcess
    : null;
}

export async function fanOutSpatialChatMessage(
  worldId: string,
  event: SpatialChatMessageCreatedEvent,
): Promise<boolean> {
  const secret = sharedSecret();
  if (!secret) return false;

  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(event),
  };

  try {
    const worker = (
      getCloudflareContext({ async: false }).env as {
        REALTIME_WORKER?: { fetch: typeof fetch };
      }
    ).REALTIME_WORKER;
    if (worker) {
      const response = await worker.fetch(
        `https://realtime.internal/office/${worldId}/internal/chat-fanout`,
        requestInit,
      );
      return response.ok;
    }
  } catch {
    // Fall back to explicit internal URL for local dev.
  }

  const base = process.env.REALTIME_WORKER_INTERNAL_URL?.replace(/\/$/u, "");
  if (!base) return false;
  const response = await fetch(
    `${base}/office/${worldId}/internal/chat-fanout`,
    requestInit,
  );
  return response.ok;
}
