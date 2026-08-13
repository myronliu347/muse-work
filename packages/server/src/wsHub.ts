import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { getLogger } from "./logger.js";
import type { WsBroadcastEvent, WsEvent } from "./wsEvents.js";

export type { WsBroadcastEvent, WsEvent } from "./wsEvents.js";

export interface WsHub {
  attach(server: HttpServer): void;
  broadcast(sessionId: string, event: WsEvent): void;
  setSnapshotProvider(provider: () => WsBroadcastEvent[]): void;
  close(): void;
}

export function createWsHub(): WsHub {
  const clients = new Map<string, Set<WebSocket>>();
  let wss: WebSocketServer | undefined;
  let attachedServer: HttpServer | undefined;
  let upgradeHandler:
    | ((req: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void)
    | undefined;
  let getSnapshot: (() => WsBroadcastEvent[]) | undefined;

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
