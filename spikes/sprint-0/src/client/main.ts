import { z } from "zod";
import {
  type PlayerState,
  type PublishedAudioRef,
  ServerEventSchema,
  TicketRequestSchema,
} from "../shared/protocol";
import { ApiRequestError, apiJson } from "./api";
import { SfuAudioClient } from "./audio-client";

const TicketResponseSchema = z.object({
  token: z.string().min(1),
  clientId: z.string().uuid(),
  expiresAt: z.number(),
});

const TurnResponseSchema = z.object({
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
});

function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
  const candidate = document.getElementById(id);
  if (!(candidate instanceof constructor)) throw new Error(`Missing #${id}`);
  return candidate;
}

const joinForm = element("join-form", HTMLFormElement);
const nameInput = element("display-name", HTMLInputElement);
const roomInput = element("room-id", HTMLInputElement);
const enterButton = element("enter", HTMLButtonElement);
const microphoneButton = element("microphone", HTMLButtonElement);
const reconnectButton = element("reconnect", HTMLButtonElement);
const turnButton = element("turn-probe", HTMLButtonElement);
const leaveButton = element("leave", HTMLButtonElement);
const world = element("world", HTMLDivElement);
const statusText = element("status", HTMLParagraphElement);
const diagnosticsText = element("diagnostics", HTMLPreElement);
const eventLog = element("event-log", HTMLPreElement);
const audioContainer = element("remote-audio", HTMLDivElement);

let ticket: string | null = null;
let clientId: string | null = null;
let webSocket: WebSocket | null = null;
let audioClient: SfuAudioClient | null = null;
let audioPreparation: Promise<void> | null = null;
let mediaEpoch = 0;
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let statsTimer: number | null = null;
let sequence = 0;
let intentionallyLeaving = false;
const players = new Map<string, PlayerState>();
const publishedTracks = new Map<string, PublishedAudioRef>();
const pressedKeys = new Set<string>();

function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  eventLog.textContent = `${line}\n${eventLog.textContent ?? ""}`.slice(0, 8_000);
}

function setStatus(message: string): void {
  statusText.textContent = message;
  log(message);
}

function ticketHeader(): string {
  if (!ticket) throw new Error("No active Sprint 0 ticket");
  return ticket;
}

function playerColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 70% 58%)`;
}

function renderPlayers(): void {
  const activeIds = new Set(players.keys());
  for (const existing of world.querySelectorAll<HTMLElement>("[data-client-id]")) {
    if (!activeIds.has(existing.dataset.clientId ?? "")) existing.remove();
  }
  for (const player of players.values()) {
    let avatar = world.querySelector<HTMLElement>(`[data-client-id="${CSS.escape(player.clientId)}"]`);
    if (!avatar) {
      avatar = document.createElement("div");
      avatar.className = "player";
      avatar.dataset.clientId = player.clientId;
      avatar.style.background = playerColor(player.clientId);
      const label = document.createElement("span");
      avatar.append(label);
      world.append(avatar);
    }
    avatar.style.transform = `translate(${player.x}px, ${player.y}px)`;
    const label = avatar.querySelector("span");
    if (label) label.textContent = `${player.displayName}${player.clientId === clientId ? " (tú)" : ""}`;
  }
}

function mediaTrackKey(ref: Pick<PublishedAudioRef, "sessionId" | "trackName">): string {
  return `${ref.sessionId}:${ref.trackName}`;
}

function remoteAudioId(ref: PublishedAudioRef): string {
  return `remote-${ref.sessionId}-${ref.trackName}`.replaceAll(/[^a-zA-Z0-9_-]/gu, "-");
}

function addRemoteAudio(ref: PublishedAudioRef, track: MediaStreamTrack): void {
  const existing = document.getElementById(remoteAudioId(ref));
  existing?.remove();
  const audio = document.createElement("audio");
  audio.id = remoteAudioId(ref);
  audio.autoplay = true;
  audio.srcObject = new MediaStream([track]);
  audioContainer.append(audio);
  void audio.play().catch((error: unknown) => {
    log(`El navegador bloqueó autoplay remoto: ${String(error)}`);
  });
  log(`Audio remoto suscrito: ${ref.ownerClientId}`);
}

function removeRemoteAudio(ref: PublishedAudioRef): void {
  const audio = document.getElementById(remoteAudioId(ref));
  if (audio instanceof HTMLAudioElement) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  }
  log(`Audio remoto desmontado: ${ref.ownerClientId}`);
}

async function handleServerEvent(raw: unknown): Promise<void> {
  const parsed = ServerEventSchema.safeParse(raw);
  if (!parsed.success) {
    log("Evento de servidor inválido descartado");
    return;
  }
  const event = parsed.data;
  switch (event.type) {
    case "office.snapshot": {
      players.clear();
      for (const player of event.players) players.set(player.clientId, player);
      const snapshotTrackKeys = new Set(event.publishedAudio.map(mediaTrackKey));
      for (const [key, track] of publishedTracks) {
        if (snapshotTrackKeys.has(key)) continue;
        audioClient?.closeRemote(track);
        publishedTracks.delete(key);
      }
      for (const track of event.publishedAudio) {
        publishedTracks.set(mediaTrackKey(track), track);
        await audioClient?.subscribe(track).catch((error: unknown) => log(`Suscripción falló: ${String(error)}`));
      }
      renderPlayers();
      setStatus(`Presencia conectada: ${event.players.length} cliente(s)`);
      break;
    }
    case "player.joined":
      players.set(event.player.clientId, event.player);
      renderPlayers();
      setStatus(`Presencia conectada: ${players.size} cliente(s)`);
      break;
    case "player.updated":
      players.set(event.player.clientId, event.player);
      renderPlayers();
      break;
    case "player.left":
      players.delete(event.clientId);
      renderPlayers();
      setStatus(`Presencia conectada: ${players.size} cliente(s)`);
      break;
    case "media.track.available":
      publishedTracks.set(mediaTrackKey(event.track), event.track);
      await audioClient?.subscribe(event.track).catch((error: unknown) => log(`Suscripción falló: ${String(error)}`));
      break;
    case "media.track.closed": {
      const key = mediaTrackKey(event);
      const ref = publishedTracks.get(key);
      if (ref) audioClient?.closeRemote(ref);
      publishedTracks.delete(key);
      break;
    }
    case "pong":
      diagnosticsText.dataset.wsRtt = String(Math.max(0, Date.now() - event.clientTime));
      break;
    case "error":
      log(`Servidor ${event.code}: ${event.message}`);
      break;
  }
}

function startPing(): void {
  if (pingTimer !== null) window.clearInterval(pingTimer);
  pingTimer = window.setInterval(() => {
    if (webSocket?.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));
    }
  }, 5_000);
}

function scheduleReconnect(): void {
  if (intentionallyLeaving || reconnectTimer !== null) return;
  const delay = Math.min(5_000, 500 * 2 ** reconnectAttempt);
  reconnectAttempt += 1;
  setStatus(`Presencia desconectada; reintento en ${delay} ms`);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectPresence();
  }, delay);
}

function prepareAudio(): Promise<void> {
  if (audioClient || audioPreparation || !ticket || !clientId || intentionallyLeaving) {
    return audioPreparation ?? Promise.resolve();
  }

  const activeTicket = ticket;
  const activeClientId = clientId;
  const activeEpoch = mediaEpoch;
  const candidate = new SfuAudioClient(activeTicket, activeClientId, {
    onState: setStatus,
    onRemoteTrack: addRemoteAudio,
    onRemoteTrackClosed: removeRemoteAudio,
  });

  audioPreparation = (async () => {
    try {
      await candidate.initialize();
      if (
        intentionallyLeaving ||
        ticket !== activeTicket ||
        clientId !== activeClientId ||
        mediaEpoch !== activeEpoch
      ) {
        await candidate.disconnect();
        return;
      }
      audioClient = candidate;
      for (const track of publishedTracks.values()) {
        await candidate.subscribe(track);
      }
      microphoneButton.disabled = false;
      startDiagnostics();
    } catch (error) {
      await candidate.disconnect();
      if (audioClient === candidate) audioClient = null;
      microphoneButton.disabled = true;
      log(`SFU no disponible; la presencia continúa: ${String(error)}`);
    } finally {
      audioPreparation = null;
      updateMicrophoneButton();
    }
  })();
  return audioPreparation;
}

function currentAudioClient(): SfuAudioClient | null {
  return audioClient;
}

function connectPresence(): void {
  const activeTicket = ticketHeader();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws?ticket=${encodeURIComponent(activeTicket)}`);
  webSocket = socket;
  socket.addEventListener("open", () => {
    if (webSocket !== socket) return;
    reconnectAttempt = 0;
    setStatus("WebSocket abierto; esperando snapshot");
    startPing();
    void prepareAudio();
  });
  socket.addEventListener("message", (event) => {
    if (webSocket !== socket || typeof event.data !== "string") return;
    try {
      void handleServerEvent(JSON.parse(event.data) as unknown);
    } catch {
      log("Mensaje WebSocket no JSON descartado");
    }
  });
  socket.addEventListener("close", () => {
    if (webSocket !== socket) return;
    webSocket = null;
    mediaEpoch += 1;
    const disconnectedAudio = audioClient;
    audioClient = null;
    microphoneButton.disabled = true;
    void disconnectedAudio?.disconnect().finally(updateMicrophoneButton);
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    if (webSocket === socket) setStatus("Error de WebSocket");
  });
}

function updateMicrophoneButton(): void {
  const active = audioClient?.isPublished ?? false;
  microphoneButton.textContent = active ? "Apagar micrófono" : "Activar micrófono";
  microphoneButton.dataset.active = String(active);
}

function startDiagnostics(): void {
  if (statsTimer !== null) window.clearInterval(statsTimer);
  statsTimer = window.setInterval(() => {
    void audioClient
      ?.diagnostics()
      .then((diagnostics) => {
        diagnosticsText.textContent = JSON.stringify(
          {
            websocketRttMs: Number(diagnosticsText.dataset.wsRtt ?? "0") || null,
            ...diagnostics,
            turnProbe: diagnosticsText.dataset.turnProbe ?? "no ejecutada",
          },
          null,
          2,
        );
      })
      .catch(() => undefined);
  }, 2_000);
}

async function enter(): Promise<void> {
  const request = TicketRequestSchema.parse({
    roomId: roomInput.value,
    displayName: nameInput.value,
  });
  const ticketResponse = TicketResponseSchema.parse(
    await apiJson("/api/spike/ticket", { body: request }),
  );
  ticket = ticketResponse.token;
  clientId = ticketResponse.clientId;
  intentionallyLeaving = false;
  connectPresence();
  enterButton.disabled = true;
  reconnectButton.disabled = false;
  turnButton.disabled = false;
  leaveButton.disabled = false;
  updateMicrophoneButton();
}

async function leave(): Promise<void> {
  intentionallyLeaving = true;
  mediaEpoch += 1;
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (pingTimer !== null) window.clearInterval(pingTimer);
  if (statsTimer !== null) window.clearInterval(statsTimer);
  pingTimer = null;
  statsTimer = null;
  webSocket?.close(1000, "User left");
  webSocket = null;
  await audioClient?.disconnect();
  audioClient = null;
  await audioPreparation;
  ticket = null;
  clientId = null;
  players.clear();
  publishedTracks.clear();
  renderPlayers();
  audioContainer.replaceChildren();
  enterButton.disabled = false;
  microphoneButton.disabled = true;
  reconnectButton.disabled = true;
  turnButton.disabled = true;
  leaveButton.disabled = true;
  updateMicrophoneButton();
  setStatus("Fuera del spike; no hay pistas locales ni remotas");
}

async function toggleMicrophone(): Promise<void> {
  if (!audioClient) return;
  microphoneButton.disabled = true;
  try {
    if (audioClient.isPublished) await audioClient.unpublishAudio();
    else {
      try {
        await audioClient.publishAudio();
      } catch (error) {
        if (!(error instanceof ApiRequestError) || ![404, 410].includes(error.status)) throw error;
        const expired = audioClient;
        audioClient = null;
        await expired.disconnect();
        log(`Sesión SFU caducada (${error.status}); creando una nueva`);
        await prepareAudio();
        const recovered = currentAudioClient();
        if (!recovered) throw error;
        await recovered.publishAudio();
      }
    }
  } finally {
    microphoneButton.disabled = false;
    updateMicrophoneButton();
  }
}

function forceReconnect(): void {
  if (!ticket) return;
  if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
  const previous = webSocket;
  webSocket = null;
  previous?.close(4000, "Manual reconnect test");
  connectPresence();
}

async function waitForRelayCandidate(peerConnection: RTCPeerConnection): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      peerConnection.removeEventListener("icecandidate", handleCandidate);
      peerConnection.removeEventListener("icegatheringstatechange", handleGatheringState);
    };
    const finish = (hasRelay: boolean) => {
      cleanup();
      resolve(hasRelay);
    };
    const hasRelayInSdp = () => peerConnection.localDescription?.sdp.includes(" typ relay ") ?? false;
    const handleCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate?.type === "relay") finish(true);
      else if (event.candidate === null && peerConnection.iceGatheringState === "complete") {
        finish(hasRelayInSdp());
      }
    };
    const handleGatheringState = () => {
      if (peerConnection.iceGatheringState === "complete") finish(hasRelayInSdp());
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("TURN relay candidate timed out"));
    }, 20_000);

    peerConnection.addEventListener("icecandidate", handleCandidate);
    peerConnection.addEventListener("icegatheringstatechange", handleGatheringState);
  });
}

async function runTurnProbe(): Promise<void> {
  const response = TurnResponseSchema.parse(
    await apiJson("/api/turn/credentials", { ticket: ticketHeader() }),
  );
  const iceServers: RTCIceServer[] = response.iceServers.map((server) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
      (url) => !url.includes(":53?"),
    );
    return {
      urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    };
  });
  const probe = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
  probe.createDataChannel("turn-allocation-probe");
  try {
    const relayCandidate = waitForRelayCandidate(probe);
    await probe.setLocalDescription(await probe.createOffer());
    const hasRelay = await relayCandidate;
    diagnosticsText.dataset.turnProbe = hasRelay ? "relay candidate obtenido" : "sin relay candidate";
    if (!hasRelay) throw new Error("Cloudflare TURN did not produce a relay candidate");
    setStatus("TURN diagnosticado: se obtuvo candidato relay efímero");
  } finally {
    probe.close();
  }
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  enterButton.disabled = true;
  void enter().catch((error: unknown) => {
    enterButton.disabled = false;
    setStatus(`Entrada falló: ${String(error)}`);
  });
});

microphoneButton.addEventListener("click", () => {
  void toggleMicrophone().catch((error: unknown) => setStatus(`Micrófono falló: ${String(error)}`));
});

reconnectButton.addEventListener("click", forceReconnect);
turnButton.addEventListener("click", () => {
  turnButton.disabled = true;
  void runTurnProbe()
    .catch((error: unknown) => setStatus(`TURN falló: ${String(error)}`))
    .finally(() => {
      turnButton.disabled = false;
    });
});
leaveButton.addEventListener("click", () => void leave());

window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"].includes(event.key)) {
    event.preventDefault();
    pressedKeys.add(event.key.toLowerCase());
  }
});
window.addEventListener("keyup", (event) => pressedKeys.delete(event.key.toLowerCase()));
window.addEventListener("beforeunload", () => {
  intentionallyLeaving = true;
  webSocket?.close(1000, "Page unload");
  void audioClient?.disconnect();
});

window.setInterval(() => {
  if (!clientId || webSocket?.readyState !== WebSocket.OPEN || pressedKeys.size === 0) return;
  const current = players.get(clientId);
  if (!current) return;
  let x = current.x;
  let y = current.y;
  if (pressedKeys.has("arrowleft") || pressedKeys.has("a")) x -= 12;
  if (pressedKeys.has("arrowright") || pressedKeys.has("d")) x += 12;
  if (pressedKeys.has("arrowup") || pressedKeys.has("w")) y -= 12;
  if (pressedKeys.has("arrowdown") || pressedKeys.has("s")) y += 12;
  x = Math.min(616, Math.max(0, x));
  y = Math.min(336, Math.max(0, y));
  sequence += 1;
  const player = { ...current, x, y, lastSeq: sequence };
  players.set(clientId, player);
  renderPlayers();
  webSocket.send(JSON.stringify({ type: "player.move", seq: sequence, x, y, clientTime: Date.now() }));
}, 125);

updateMicrophoneButton();
