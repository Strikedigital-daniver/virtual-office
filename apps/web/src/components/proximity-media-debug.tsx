"use client";

import type { ProximityZone } from "@virtual-office/shared";

export interface ProximityDebugRow {
  localParticipantId: string | null;
  remoteParticipantId: string;
  distance: number;
  audioFactor: number;
  videoFactor: number;
  proximityZone: ProximityZone;
  desiredSubscription: boolean;
  actualAudioSubscribed: boolean;
  actualVideoSubscribed: boolean;
}

export function ProximityMediaDebugPanel({
  rows,
}: {
  rows: ProximityDebugRow[];
}) {
  if (rows.length === 0) return null;

  return (
    <details className="proximity-debug">
      <summary>Proximidad media (debug)</summary>
      <table>
        <thead>
          <tr>
            <th>Remoto</th>
            <th>Dist</th>
            <th>Zona</th>
            <th>Audio</th>
            <th>Video</th>
            <th>Desea sub</th>
            <th>Audio sub</th>
            <th>Video sub</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.remoteParticipantId} data-remote-id={row.remoteParticipantId}>
              <td>{row.remoteParticipantId.slice(0, 8)}</td>
              <td>{Math.round(row.distance)}</td>
              <td>{row.proximityZone}</td>
              <td>{row.audioFactor.toFixed(2)}</td>
              <td>{row.videoFactor.toFixed(2)}</td>
              <td>{row.desiredSubscription ? "sí" : "no"}</td>
              <td>{row.actualAudioSubscribed ? "sí" : "no"}</td>
              <td>{row.actualVideoSubscribed ? "sí" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function proximityDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_APP_ENV === "staging") return true;
  return new URLSearchParams(window.location.search).has("proximityDebug");
}
