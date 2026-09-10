"use client";

import type { ChatDiagnosticsSnapshot } from "@/lib/spatial-debug/chat-diagnostics";
import type { MediaDiagnosticsSnapshot } from "@/lib/spatial-debug/media-diagnostics";
import { shortId } from "@/lib/spatial-debug/enabled";

export function buildSpatialDiagnosticExport(input: {
  media: MediaDiagnosticsSnapshot;
  chat: ChatDiagnosticsSnapshot;
  websocketStatus: string;
}): string {
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      websocketStatus: input.websocketStatus,
      media: input.media,
      chat: input.chat,
    },
    null,
    2,
  );
}

export function SpatialDebugPanel({
  media,
  chat,
  websocketStatus,
  diagnosticAudioBypass,
  onToggleDiagnosticAudioBypass,
}: {
  media: MediaDiagnosticsSnapshot;
  chat: ChatDiagnosticsSnapshot;
  websocketStatus: string;
  diagnosticAudioBypass: boolean;
  onToggleDiagnosticAudioBypass: () => void;
}) {
  const copy = async () => {
    const payload = buildSpatialDiagnosticExport({
      media,
      chat,
      websocketStatus,
    });
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Fallback for browsers without clipboard permission.
      const textarea = document.createElement("textarea");
      textarea.value = payload;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  };

  return (
    <details className="spatial-debug-panel" open>
      <summary>Diagnóstico Spatial (staging)</summary>
      <div className="spatial-debug-actions">
        <button type="button" onClick={() => void copy()}>
          Copiar diagnóstico
        </button>
        <button type="button" onClick={onToggleDiagnosticAudioBypass}>
          {diagnosticAudioBypass
            ? "HTML audio: ON (debug)"
            : "WebAudio mixer: ON (default)"}
        </button>
      </div>

      <section>
        <h4>LOCAL AUDIO</h4>
        <ul className="spatial-debug-list">
          <li>micUiState: {media.local.micUiState}</li>
          <li>getUserMediaTrack: {media.local.getUserMediaTrack}</li>
          <li>track.enabled: {String(media.local.trackEnabled)}</li>
          <li>track.muted: {String(media.local.trackMuted)}</li>
          <li>senderExists: {String(media.local.senderExists)}</li>
          <li>senderTrackPresent: {String(media.local.senderTrackPresent)}</li>
          <li>senderTrackId: {media.local.senderTrackId ?? "—"}</li>
          <li>
            transceiverDirection: {media.local.transceiverDirection ?? "—"}
          </li>
          <li>transceiverCount: {media.local.transceiverCount ?? "—"}</li>
          <li>
            sendPeerConnection: {media.local.sendPeerConnectionState ?? "—"}
          </li>
          <li>signalingState: {media.local.sendSignalingState ?? "—"}</li>
          <li>
            iceConnectionState: {media.local.sendIceConnectionState ?? "—"}
          </li>
          <li>
            recvPeerConnection: {media.local.recvPeerConnectionState ?? "—"}
          </li>
          <li>recvSignalingState: {media.local.recvSignalingState ?? "—"}</li>
          <li>
            recvIceConnectionState: {media.local.recvIceConnectionState ?? "—"}
          </li>
          <li>
            audioPublication: {media.local.audioPublicationKnown ? "yes" : "no"}
          </li>
          <li>audioPublicationId: {media.local.audioPublicationId ?? "—"}</li>
          <li>lastPublishStep: {media.local.lastPublishStep ?? "—"}</li>
          <li>lastPublishError: {media.local.lastPublishError ?? "—"}</li>
          <li>lastMediaError: {media.local.lastMediaError ?? "—"}</li>
          <li>localZoneId: {media.local.localZoneId ?? "—"}</li>
          <li>selfAccessClass: {media.local.selfAccessClass ?? "—"}</li>
          <li>AudioContext: {media.local.audioContextState ?? "—"}</li>
          <li>
            audioOutputUnlocked: {String(media.local.audioOutputUnlocked)}
          </li>
          <li>mixerKeys: {media.local.mixerAttachedKeys.join(", ") || "—"}</li>
          <li>
            htmlAudioKeys: {media.local.audioFallbackKeys.join(", ") || "—"}
          </li>
        </ul>
      </section>

      {media.remotes.map((remote) => (
        <section key={remote.userId}>
          <h4>REMOTE: {remote.displayName || shortId(remote.userId)}</h4>
          <ul className="spatial-debug-list">
            <li>distanceTiles: {remote.distanceTiles?.toFixed(2) ?? "—"}</li>
            <li>localZoneId: {remote.localZoneId ?? "—"}</li>
            <li>remoteZoneId: {remote.remoteZoneId ?? "—"}</li>
            <li>
              audioAuthorizationReason: {remote.audioAuthorizationReason ?? "—"}
            </li>
            <li>
              videoAuthorizationReason: {remote.videoAuthorizationReason ?? "—"}
            </li>
            <li>
              proximityAuthorized (audio):{" "}
              {String(remote.proximityAudioAuthorized)}
            </li>
            <li>
              audioPublication: {remote.audioPublicationKnown ? "yes" : "no"}
            </li>
            <li>audioPublicationId: {remote.audioPublicationId ?? "—"}</li>
            <li>
              subscriptionRequested: {String(remote.subscriptionRequested)}
            </li>
            <li>subscriptionResult: {remote.subscriptionResult}</li>
            <li>subscriptionError: {remote.subscriptionError ?? "—"}</li>
            <li>
              remoteAudioTrack: {remote.remoteAudioTrackReceived ? "yes" : "no"}
            </li>
            <li>track.readyState: {remote.trackReadyState ?? "—"}</li>
            <li>track.muted: {String(remote.trackMuted)}</li>
            <li>track.enabled: {String(remote.trackEnabled)}</li>
            <li>gainNodeAttached: {String(remote.gainNodeAttached)}</li>
            <li>mixerAttached: {String(remote.mixerSourceAttached)}</li>
            <li>currentGain: {remote.currentGain?.toFixed(3) ?? "—"}</li>
            <li>fallbackAudio: {remote.fallbackAudioElement}</li>
            <li>htmlAudioState: {remote.htmlAudioState}</li>
            <li>lastPlayError: {remote.lastPlayError ?? "—"}</li>
            <li>lastAudioError: {remote.lastAudioError ?? "—"}</li>
            <li>recvPeerConnection: {remote.recvPeerConnectionState ?? "—"}</li>
          </ul>
        </section>
      ))}

      <section>
        <h4>CHAT</h4>
        <ul className="spatial-debug-list">
          <li>selectedChannelId: {shortId(chat.selectedChannelId)}</li>
          <li>panelOpen: {String(chat.panelOpen)}</li>
          <li>initialLoad: {chat.initialLoad}</li>
          <li>sending: {String(chat.sending)}</li>
          <li>REST authenticated: {String(chat.restAuthenticated)}</li>
          <li>websocket: {chat.websocket}</li>
          <li>listenerCount: {chat.listenerCount}</li>
          <li>receivedEventCount: {chat.receivedEventCount}</li>
          <li>renderedMessageCount: {chat.renderedMessageCount}</li>
          <li>queuedLiveMessages: {chat.queuedLiveMessages}</li>
          <li>liveBufferSize: {chat.liveBufferSize}</li>
          <li>channelsLoading: {String(chat.channelsLoading)}</li>
          <li>loadGeneration: {chat.loadGeneration}</li>
          <li>lastRESTStatus: {chat.lastRestStatus ?? "—"}</li>
          <li>lastRESTError: {chat.lastRestError ?? "—"}</li>
          <li>lastFanoutWarning: {chat.lastFanoutWarning ?? "—"}</li>
          <li>lastRealtimeEventAt: {chat.lastRealtimeEventAt ?? "—"}</li>
          <li>inputFocused: {String(chat.inputFocused)}</li>
          <li>keyboardGuardActive: {String(chat.keyboardGuardActive)}</li>
        </ul>
        <pre className="spatial-debug-trace">
          {chat.recentTransitions.join("\n") || "sin transiciones"}
        </pre>
      </section>

      <section>
        <h4>MEDIA EVENTS</h4>
        <pre className="spatial-debug-trace">
          {media.recentEvents.join("\n") || "sin eventos"}
        </pre>
      </section>
    </details>
  );
}
