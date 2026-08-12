import type { VsCodeApi } from "../types";
import { MuseApiClient } from "./apiClient.js";
import { MuseWsClient, type MuseWsEvent } from "./wsClient.js";

export interface HostBridgeOptions {
  api: MuseApiClient;
  ws: MuseWsClient;
  /** Default workdir for createSession */
  workdir?: string;
  /** Optional outer host API for unhandled commands */
  outer?: VsCodeApi;
  openExternal?: (url: string) => void;
}

function postToWebview(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Minimal host bridge: maps legacy webview postMessage commands onto Muse HTTP/WS.
 * Compatible subset: login / logout / sendMessage / confirmationResponse (+ auth bootstrap).
 */
export function createHostBridge(opts: HostBridgeOptions): VsCodeApi {
  const { api, ws } = opts;
  const workdir = opts.workdir ?? "/";
  const openExternal =
    opts.openExternal ??
    ((url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    });

  let sessionId: string | null = null;
  let streamingMessageId: string | null = null;
  let state: unknown = null;
  let bootstrapped = false;

  const emitWs = (event: MuseWsEvent) => {
    if (event.type === "message:delta") {
      if (!streamingMessageId) {
        streamingMessageId = newId("asst");
        postToWebview({ command: "startStreaming" });
        postToWebview({
          command: "appendMessage",
          message: {
            id: streamingMessageId,
            role: "assistant",
            timestamp: new Date().toISOString(),
            blocks: [{ type: "text", content: "", stage: "streaming" }],
          },
        });
      }
      postToWebview({
        command: "updateStreamingContent",
        messageId: streamingMessageId,
        chunk: event.text,
        stage: "streaming",
      });
      return;
    }

    if (event.type === "message:completed") {
      if (streamingMessageId) {
        postToWebview({
          command: "updateStreamingContent",
          messageId: streamingMessageId,
          chunk: "",
          stage: "end",
        });
      }
      streamingMessageId = null;
      postToWebview({ command: "endStreaming" });
      return;
    }

    if (event.type === "permission:request") {
      postToWebview({
        command: "showConfirmation",
        confirmationId: event.permissionId,
        toolName: event.toolName,
        confirmationType: "tool",
        toolInput: event.description,
      });
      return;
    }

    if (event.type === "auth:changed") {
      const status = event.status as { state?: string } | undefined;
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: status?.state === "authenticated",
      });
      return;
    }

    if (event.type === "session:status" && event.status === "error") {
      postToWebview({
        command: "updateErrorBlock",
        error: "Session error",
      });
      postToWebview({ command: "endStreaming" });
      streamingMessageId = null;
    }
  };

  ws.onEvent(emitWs);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const session = await api.createSession(workdir);
    sessionId = session.id;
    ws.connect(sessionId);
    postToWebview({
      command: "updateCurrentSession",
      session: {
        id: session.id,
        title: "Muse",
        createdAt: session.createdAt,
        updatedAt: session.createdAt,
      },
    });
    return sessionId;
  }

  async function refreshAuth(): Promise<void> {
    try {
      const status = await api.getAuthStatus();
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: status.state === "authenticated",
      });
    } catch {
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: false,
      });
    }
  }

  async function handleLogin(): Promise<void> {
    try {
      const start = await api.login();
      if (start && typeof start === "object" && "authUrl" in start && start.authUrl) {
        openExternal(start.authUrl);
        await api.login({ wait: true });
      }
      await refreshAuth();
      postToWebview({ command: "loginResponse", success: true });
    } catch (err) {
      postToWebview({
        command: "loginResponse",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      await api.logout();
      postToWebview({ command: "logoutResponse", success: true });
      postToWebview({ command: "authStatusResponse", isAuthenticated: false });
    } catch (err) {
      postToWebview({
        command: "logoutResponse",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleSendMessage(msg: {
    text?: string;
    images?: unknown;
  }): Promise<void> {
    const text = (msg.text ?? "").trim();
    if (!text) return;

    const userId = newId("user");
    postToWebview({
      command: "appendMessage",
      message: {
        id: userId,
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", content: text }],
      },
    });

    try {
      const sid = await ensureSession();
      streamingMessageId = null;
      await api.sendMessage(sid, text);
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
      postToWebview({ command: "endStreaming" });
    }
  }

  async function handleConfirmationResponse(msg: {
    confirmationId?: string;
    decision?: string;
  }): Promise<void> {
    if (!sessionId || !msg.confirmationId) return;
    const decision =
      msg.decision === "deny" || msg.decision === "reject" ? "deny" : "allow";
    try {
      await api.respondPermission(sessionId, msg.confirmationId, decision);
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const bridge: VsCodeApi = {
    postMessage(raw: unknown) {
      const msg = raw as { command?: string; [k: string]: unknown };
      const command = msg?.command;
      if (!command) {
        opts.outer?.postMessage(raw);
        return;
      }

      switch (command) {
        case "login":
          void handleLogin();
          return;
        case "logout":
          void handleLogout();
          return;
        case "sendMessage":
          void handleSendMessage(msg as { text?: string });
          return;
        case "confirmationResponse":
          void handleConfirmationResponse(
            msg as { confirmationId?: string; decision?: string },
          );
          return;
        case "webviewReady":
        case "getAuthStatus":
          void refreshAuth();
          return;
        case "openExternal":
          if (typeof msg.url === "string") openExternal(msg.url);
          return;
        default:
          opts.outer?.postMessage(raw);
      }
    },
    getState() {
      return state ?? opts.outer?.getState() ?? null;
    },
    setState(next: unknown) {
      state = next;
      opts.outer?.setState(next);
    },
  };

  // Bootstrap auth once the bridge is created (ChatApp also requests via webviewReady).
  if (!bootstrapped) {
    bootstrapped = true;
    queueMicrotask(() => {
      void refreshAuth();
    });
  }

  return bridge;
}

export function resolveMuseServerUrl(): string {
  const w = window as Window & {
    __MUSE_SERVER_URL__?: string;
    museServerUrl?: string;
  };
  return (
    w.__MUSE_SERVER_URL__ ||
    w.museServerUrl ||
    "http://127.0.0.1:8787"
  );
}
