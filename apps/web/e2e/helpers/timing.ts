/** Presupuesto E2E alineado a LEEME_AUDIO_QA: suite ≤ 5 minutos. */
export const E2E_TIMING = {
  testTimeoutMs: 5 * 60_000,
  loginRedirectMs: 60_000,
  officeConnectMs: 60_000,
  canvasReadyMs: 20_000,
  mediaReadyMs: 45_000,
  remotePeerMs: 25_000,
  moveTimeoutMs: 18_000,
  reloadConnectMs: 45_000,
  recoveryAttempts: 1,
  unsubscribeSettleMs: 3_500,
  defaultSettleMs: 1_000,
} as const;
