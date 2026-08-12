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
  private connectPromise: Promise<void> | null = null;
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

  connect(sessionId: string): Promise<void> {
    if (this.sessionId === sessionId && this.socket) {
      const state = this.socket.readyState;
      if (state === this.WebSocketImpl.OPEN) {
        return Promise.resolve();
      }
      if (state === this.WebSocketImpl.CONNECTING && this.connectPromise) {
        return this.connectPromise;
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
    this.connectPromise = new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("WebSocket connection failed"));
      };
      const onClose = () => {
        if (socket.readyState !== this.WebSocketImpl.OPEN) {
          cleanup();
          reject(new Error("WebSocket closed before open"));
        }
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
    return this.connectPromise;
  }

  close(): void {
    this.connectPromise = null;
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
