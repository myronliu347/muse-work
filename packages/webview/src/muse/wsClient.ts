export type MuseWsEventPayload =
  | {
      type: "message:delta";
      messageId?: string;
      text: string;
      stage?: "streaming" | "end";
    }
  | { type: "message:completed"; messageId?: string }
  | { type: "assistant:message"; messageId: string }
  | {
      type: "reasoning:delta";
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | { type: "tool:update"; params: Record<string, unknown> }
  | { type: "loading"; loading: boolean }
  | {
      type: "permission:request";
      permissionId: string;
      toolName: string;
      description: string;
      toolInput?: Record<string, unknown>;
      planContent?: string;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
      permissionMode?: string;
      toolCallId?: string;
    }
  | { type: "session:status"; status: string; error?: string }
  | { type: "auth:changed"; status: unknown }
  | { type: "compaction:state"; isCompacting: boolean }
  | { type: "messages:replace"; messages: unknown[] }
  | {
      type: "subagent:assistant:message";
      subagentId: string;
      messageId: string;
    }
  | {
      type: "subagent:message:delta";
      subagentId: string;
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | {
      type: "subagent:reasoning:delta";
      subagentId: string;
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | {
      type: "subagent:tool:update";
      subagentId: string;
      params: Record<string, unknown>;
    }
  | {
      type: "subagent:messages";
      subagentId: string;
      messages: unknown[];
    }
  | { type: "session:unread"; unreadDone: boolean };

export type MuseWsEvent = MuseWsEventPayload & { sessionId: string };

export type MuseWsEventHandler = (event: MuseWsEvent) => void;

export type MuseWsStatus = "open" | "closed" | "reconnecting";

export type MuseWsStatusHandler = (status: MuseWsStatus) => void;

export interface MuseWsClientOptions {
  /** HTTP base URL; converted to ws(s):// for /ws */
  baseUrl: string;
  WebSocketImpl?: typeof WebSocket;
  /** Auto-reconnect after unexpected close. Default true. */
  reconnect?: boolean;
  /** Base delay before the first reconnect (default 500ms). */
  reconnectBackoffMs?: number;
  /** Cap for exponential backoff (default 8000ms). */
  maxReconnectBackoffMs?: number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (id: ReturnType<typeof setTimeout>) => void;
}

function toWsBase(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.origin;
}

export class MuseWsClient {
  private readonly wsBase: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly reconnectEnabled: boolean;
  private readonly reconnectBackoffMs: number;
  private readonly maxReconnectBackoffMs: number;
  private readonly schedule: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearSchedule: (id: ReturnType<typeof setTimeout>) => void;
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private handlers = new Set<MuseWsEventHandler>();
  private statusHandlers = new Set<MuseWsStatusHandler>();
  private closedByUser = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: MuseWsStatus | null = null;
  private generation = 0;

  constructor(opts: MuseWsClientOptions) {
    this.wsBase = toWsBase(opts.baseUrl);
    this.WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
    this.reconnectEnabled = opts.reconnect !== false;
    this.reconnectBackoffMs = opts.reconnectBackoffMs ?? 500;
    this.maxReconnectBackoffMs = opts.maxReconnectBackoffMs ?? 8000;
    this.schedule = opts.schedule ?? setTimeout;
    this.clearSchedule = opts.clearSchedule ?? clearTimeout;
  }

  onEvent(handler: MuseWsEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(handler: MuseWsStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  connect(sessionId: string = "*"): Promise<void> {
    this.closedByUser = false;
    if (this.sessionId === sessionId && this.socket) {
      const state = this.socket.readyState;
      if (state === this.WebSocketImpl.OPEN) {
        return Promise.resolve();
      }
      if (state === this.WebSocketImpl.CONNECTING && this.connectPromise) {
        return this.connectPromise;
      }
    }
    this.clearReconnectTimer();
    this.disposeSocket();
    this.sessionId = sessionId;
    return this.openSocket();
  }

  reconnectNow(): Promise<void> {
    this.closedByUser = false;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    const sessionId = this.sessionId ?? "*";
    this.disposeSocket();
    this.sessionId = sessionId;
    this.emitStatus("reconnecting");
    return this.openSocket();
  }

  close(): void {
    this.closedByUser = true;
    this.clearReconnectTimer();
    this.disposeSocket();
    this.sessionId = null;
    this.emitStatus("closed");
  }

  private openSocket(): Promise<void> {
    const sessionId = this.sessionId ?? "*";
    const generation = this.generation;
    const url = `${this.wsBase}/ws?sessionId=${encodeURIComponent(sessionId)}`;
    const socket = new this.WebSocketImpl(url);
    this.socket = socket;
    socket.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as MuseWsEvent;
        for (const handler of this.handlers) {
          handler(data);
        }
      } catch {
        // ignore malformed frames
      }
    });
    this.connectPromise = new Promise((resolve, reject) => {
      const onOpen = () => {
        if (generation !== this.generation) return;
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        this.reconnectAttempt = 0;
        this.emitStatus("open");
        resolve();
      };
      const onError = () => {
        if (generation !== this.generation) return;
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        reject(new Error("WebSocket connection failed"));
      };
      const onClose = () => {
        if (generation !== this.generation) return;
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        this.socket = null;
        this.connectPromise = null;
        if (this.status !== "open") {
          reject(new Error("WebSocket closed before open"));
        }
        this.handleUnexpectedClose();
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
    return this.connectPromise;
  }

  private handleUnexpectedClose(): void {
    if (this.closedByUser) return;
    if (!this.reconnectEnabled || !this.sessionId) {
      this.emitStatus("closed");
      return;
    }
    this.emitStatus("closed");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.reconnectBackoffMs * 2 ** (this.reconnectAttempt - 1),
      this.maxReconnectBackoffMs,
    );
    this.emitStatus("reconnecting");
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      if (this.closedByUser || !this.sessionId) return;
      void this.openSocket().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  private disposeSocket(): void {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    this.clearSchedule(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private emitStatus(status: MuseWsStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}
