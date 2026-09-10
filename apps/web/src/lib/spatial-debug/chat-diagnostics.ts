export type ChatLoadState = "idle" | "loading" | "success" | "error";
export type ChatWsState = "connected" | "disconnected" | "reconnecting";

export interface ChatDiagnosticsSnapshot {
  capturedAt: string;
  selectedChannelId: string | null;
  panelOpen: boolean;
  initialLoad: ChatLoadState;
  sending: boolean;
  restAuthenticated: boolean;
  websocket: ChatWsState;
  listenerCount: number;
  receivedEventCount: number;
  renderedMessageCount: number;
  queuedLiveMessages: number;
  liveBufferSize: number;
  lastRestStatus: number | null;
  lastRestError: string | null;
  lastFanoutWarning: string | null;
  lastRealtimeEventAt: string | null;
  inputFocused: boolean;
  keyboardGuardActive: boolean;
  channelsLoading: boolean;
  loadGeneration: number;
  recentTransitions: string[];
}

export class ChatDiagnosticsTrace {
  private transitions: string[] = [];
  private receivedEventCount = 0;
  private listenerCount = 0;
  private lastRestStatus: number | null = null;
  private lastRestError: string | null = null;
  private lastFanoutWarning: string | null = null;
  private lastRealtimeEventAt: string | null = null;

  private push(label: string): void {
    const line = `${new Date().toISOString().slice(11, 23)} ${label}`;
    this.transitions = [...this.transitions.slice(-39), line];
  }

  transition(label: string): void {
    this.push(label);
  }

  setListenerCount(count: number): void {
    this.listenerCount = count;
  }

  restFinished(status: number, error: string | null): void {
    this.lastRestStatus = status;
    this.lastRestError = error;
    this.push(`REST ${status}${error ? ` err=${error.slice(0, 80)}` : ""}`);
  }

  fanoutWarning(message: string): void {
    this.lastFanoutWarning = message.slice(0, 240);
    this.push(`FANOUT_WARN ${this.lastFanoutWarning.slice(0, 80)}`);
  }

  liveEvent(): void {
    this.receivedEventCount += 1;
    this.lastRealtimeEventAt = new Date().toISOString();
    this.push("LIVE_EVENT");
  }

  snapshot(input: {
    selectedChannelId: string | null;
    panelOpen: boolean;
    initialLoad: ChatLoadState;
    sending: boolean;
    restAuthenticated: boolean;
    websocket: ChatWsState;
    renderedMessageCount: number;
    queuedLiveMessages: number;
    liveBufferSize: number;
    inputFocused: boolean;
    keyboardGuardActive: boolean;
    channelsLoading: boolean;
    loadGeneration: number;
  }): ChatDiagnosticsSnapshot {
    return {
      capturedAt: new Date().toISOString(),
      selectedChannelId: input.selectedChannelId,
      panelOpen: input.panelOpen,
      initialLoad: input.initialLoad,
      sending: input.sending,
      restAuthenticated: input.restAuthenticated,
      websocket: input.websocket,
      listenerCount: this.listenerCount,
      receivedEventCount: this.receivedEventCount,
      renderedMessageCount: input.renderedMessageCount,
      queuedLiveMessages: input.queuedLiveMessages,
      liveBufferSize: input.liveBufferSize,
      lastRestStatus: this.lastRestStatus,
      lastRestError: this.lastRestError,
      lastFanoutWarning: this.lastFanoutWarning,
      lastRealtimeEventAt: this.lastRealtimeEventAt,
      inputFocused: input.inputFocused,
      keyboardGuardActive: input.keyboardGuardActive,
      channelsLoading: input.channelsLoading,
      loadGeneration: input.loadGeneration,
      recentTransitions: [...this.transitions],
    };
  }
}
