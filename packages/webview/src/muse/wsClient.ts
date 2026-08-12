export type MuseWsEvent =
  | { type: "message:delta"; text: string }
  | { type: "message:completed" }
  | {
      type: "permission:request";
      permissionId: string;
      toolName: string;
      description: string;
    }
  | { type: "session:status"; status: string }
  | { type: "auth:changed"; status: unknown };

export type MuseWsEventHandler = (event: MuseWsEvent) => void;

export interface MuseWsClientOptions {
  /** HTTP base URL; converted to ws(s):// for /ws */
  baseUrl: string;
  WebSocketImpl?: typeof WebSocket;
}

function toWsBase(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.origin;
}

export class MuseWsClient {
  private readonly wsBase: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private handlers = new Set<MuseWsEventHandler>();

  constructor(opts: MuseWsClientOptions) {
    this.wsBase = toWsBase(opts.baseUrl);
    this.WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
  }

  onEvent(handler: MuseWsEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  connect(sessionId: string): void {
    if (this.sessionId === sessionId && this.socket) {
      const state = this.socket.readyState;
      if (
        state === this.WebSocketImpl.OPEN ||
        state === this.WebSocketImpl.CONNECTING
      ) {
        return;
      }
    }
    this.close();
    this.sessionId = sessionId;
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
  }

  close(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.sessionId = null;
  }
}
