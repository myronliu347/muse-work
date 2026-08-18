import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { getLogger } from "../utils/logger.js";
import type { WsBroadcastEvent, WsEvent } from "./wsEvents.js";

export type { WsBroadcastEvent, WsEvent } from "./wsEvents.js";

export type HeartbeatSocket = {
  readyState: number;
  OPEN?: number;
  isAlive?: boolean;
  ping: () => void;
  terminate: () => void;
};

export function sweepWsHeartbeat(sockets: HeartbeatSocket[]): void {
  for (const ws of sockets) {
    const open = ws.OPEN ?? 1;
    if (ws.readyState !== open) continue;
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // ignore
    }
  }
}

export type CreateWsHubOptions = {
  pingIntervalMs?: number;
  schedule?: typeof setInterval;
  clearSchedule?: typeof clearInterval;
};

export interface WsHub {
  attach(server: HttpServer): void;
  broadcast(sessionId: string, event: WsEvent): void;
  setSnapshotProvider(provider: () => WsBroadcastEvent[]): void;
  /** Total connected WebSocket clients across all sessions (for runtime stats). */
  clientCount(): number;
  close(): void;
}

export function createWsHub(options: CreateWsHubOptions = {}): WsHub {
  const clients = new Map<string, Set<WebSocket>>();
  let wss: WebSocketServer | undefined;
  let attachedServer: HttpServer | undefined;
  let upgradeHandler:
    | ((req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void)
    | undefined;
  let getSnapshot: (() => WsBroadcastEvent[]) | undefined;
  const pingIntervalMs =
    options.pingIntervalMs ?? (process.env.VITEST ? 0 : 30_000);
  const scheduleHeartbeat = options.schedule ?? setInterval;
  const clearHeartbeat = options.clearSchedule ?? clearInterval;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  function sendSnapshot(sessionId: string, ws: WebSocket): void {
    const events = getSnapshot?.() ?? [];
    for (const event of events) {
      if (sessionId !== "*" && event.sessionId !== sessionId) continue;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(event));
      }
    }
  }

  function addClient(sessionId: string, ws: WebSocket): void {
    let set = clients.get(sessionId);
    if (!set) {
      set = new Set();
      clients.set(sessionId, set);
    }
    set.add(ws);
    const alive = ws as WebSocket & { isAlive: boolean };
    alive.isAlive = true;
    ws.on("pong", () => {
      alive.isAlive = true;
    });
    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(String(raw)) as { type?: string };
        if (data?.type === "ping" && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore non-JSON / unrelated frames
      }
    });
    getLogger().info("ws connected", { sessionId, clients: set.size });
    sendSnapshot(sessionId, ws);
    ws.on("close", () => {
      set!.delete(ws);
      getLogger().info("ws disconnected", {
        sessionId,
        clients: set!.size,
      });
      if (set!.size === 0) {
        clients.delete(sessionId);
      }
    });
  }

  return {
    setSnapshotProvider(provider: () => WsBroadcastEvent[]): void {
      getSnapshot = provider;
    },

    attach(server: HttpServer): void {
      if (wss) {
        return;
      }
      wss = new WebSocketServer({ noServer: true });
      attachedServer = server;

      upgradeHandler = (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/ws") {
          socket.destroy();
          return;
        }
        const sessionId = url.searchParams.get("sessionId") ?? "*";
        wss!.handleUpgrade(req, socket, head, (ws) => {
          addClient(sessionId, ws);
          wss!.emit("connection", ws, req);
        });
      };

      server.on("upgrade", upgradeHandler);
      if (pingIntervalMs > 0 && !heartbeatTimer) {
        heartbeatTimer = scheduleHeartbeat(() => {
          const sockets: HeartbeatSocket[] = [];
          for (const set of clients.values()) {
            sockets.push(...set);
          }
          sweepWsHeartbeat(sockets);
        }, pingIntervalMs);
      }
    },

    clientCount(): number {
      let total = 0;
      for (const set of clients.values()) {
        total += set.size;
      }
      return total;
    },

    broadcast(sessionId: string, event: WsEvent): void {
      const payload = JSON.stringify({ ...event, sessionId } satisfies WsBroadcastEvent);
      const delivered = new Set<WebSocket>();
      for (const key of [sessionId, "*"]) {
        const set = clients.get(key);
        if (!set) {
          continue;
        }
        for (const ws of set) {
          if (delivered.has(ws)) {
            continue;
          }
          delivered.add(ws);
          if (ws.readyState === ws.OPEN) {
            ws.send(payload);
          }
        }
      }
    },

    close(): void {
      if (heartbeatTimer !== undefined) {
        clearHeartbeat(heartbeatTimer);
        heartbeatTimer = undefined;
      }
      if (attachedServer && upgradeHandler) {
        attachedServer.off("upgrade", upgradeHandler);
      }
      for (const set of clients.values()) {
        for (const ws of set) {
          ws.close();
        }
      }
      clients.clear();
      wss?.close();
      wss = undefined;
      attachedServer = undefined;
      upgradeHandler = undefined;
    },
  };
}
