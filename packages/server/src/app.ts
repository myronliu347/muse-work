import http from "node:http";
import type { AppContext } from "./createAppContext.js";
import { sendError } from "./http.js";
import { getLogger } from "./logger.js";
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthStatus,
} from "./routes/auth.js";
import { handleHealth } from "./routes/health.js";
import {
  handleGetSettings,
  handlePatchSettings,
} from "./routes/settings.js";
import { handleControlResume } from "./routes/control.js";
import {
  handleCodeMakerQuota,
  handleGetOpenAiCompatibleConfig,
  handleListModels,
  handleListProviders,
  handlePatchOpenAiCompatibleConfig,
  handleSetActive,
} from "./routes/providers.js";
import {
  handleAbortMessage,
  handleCreateSession,
  handleDeleteSession,
  handleGetMessages,
  handleGetSession,
  handleListSessions,
  handlePatchSession,
  handleRespondPermission,
  handleSelectSession,
  handleSendMessage,
} from "./routes/sessions.js";

function attachAccessLog(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): void {
  // Health probes are noisy; keep them at debug.
  if (pathname === "/health") {
    const started = Date.now();
    res.on("finish", () => {
      getLogger().debug("http", {
        method: req.method ?? "GET",
        path: pathname,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });
    return;
  }

  const started = Date.now();
  res.on("finish", () => {
    getLogger().info("http", {
      method: req.method ?? "GET",
      path: pathname,
      status: res.statusCode,
      ms: Date.now() - started,
    });
  });
}

export function createApp(ctx: AppContext): http.Server {
  const server = http.createServer((req, res) => {
    void routeRequest(req, res, ctx).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      getLogger().error("request failed", {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        error: message,
      });
      if (!res.headersSent) {
        sendError(res, 500, message);
      } else {
        res.end();
      }
    });
  });
  ctx.hub.attach(server);
  return server;
}

async function routeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  attachAccessLog(req, res, pathname);

  if (method === "GET" && pathname === "/health") {
    await handleHealth(req, res);
    return;
  }

  if (method === "GET" && pathname === "/settings") {
    await handleGetSettings(req, res, ctx);
    return;
  }

  if (method === "PATCH" && pathname === "/settings") {
    await handlePatchSettings(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/control/resume") {
    await handleControlResume(req, res, ctx);
    return;
  }

  if (method === "GET" && pathname === "/providers") {
    await handleListProviders(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/providers/active") {
    await handleSetActive(req, res, ctx);
    return;
  }

  if (method === "GET" && pathname === "/providers/codemaker/quota") {
    await handleCodeMakerQuota(req, res, ctx);
    return;
  }

  if (method === "GET" && pathname === "/providers/openai-compatible") {
    await handleGetOpenAiCompatibleConfig(req, res, ctx);
    return;
  }

  if (method === "PATCH" && pathname === "/providers/openai-compatible") {
    await handlePatchOpenAiCompatibleConfig(req, res, ctx);
    return;
  }

  const modelsMatch = pathname.match(/^\/providers\/([^/]+)\/models$/);
  if (method === "GET" && modelsMatch) {
    await handleListModels(req, res, ctx, decodeURIComponent(modelsMatch[1]!));
    return;
  }

  if (method === "GET" && pathname === "/auth/status") {
    await handleAuthStatus(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/auth/login") {
    await handleAuthLogin(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/auth/logout") {
    await handleAuthLogout(req, res, ctx);
    return;
  }

  if (method === "GET" && pathname === "/sessions") {
    await handleListSessions(req, res, ctx);
    return;
  }

  if (method === "POST" && pathname === "/sessions") {
    await handleCreateSession(req, res, ctx);
    return;
  }

  const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]!);
    if (method === "GET") {
      await handleGetSession(req, res, ctx, sessionId);
      return;
    }
    if (method === "PATCH") {
      await handlePatchSession(req, res, ctx, sessionId);
      return;
    }
    if (method === "DELETE") {
      await handleDeleteSession(req, res, ctx, sessionId);
      return;
    }
  }

  const selectMatch = pathname.match(/^\/sessions\/([^/]+)\/select$/);
  if (method === "POST" && selectMatch) {
    await handleSelectSession(
      req,
      res,
      ctx,
      decodeURIComponent(selectMatch[1]!),
    );
    return;
  }

  const messageMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
  if (messageMatch) {
    const sessionId = decodeURIComponent(messageMatch[1]!);
    if (method === "GET") {
      await handleGetMessages(req, res, ctx, sessionId);
      return;
    }
    if (method === "POST") {
      await handleSendMessage(req, res, ctx, sessionId);
      return;
    }
  }

  const abortMatch = pathname.match(/^\/sessions\/([^/]+)\/abort$/);
  if (method === "POST" && abortMatch) {
    await handleAbortMessage(
      req,
      res,
      ctx,
      decodeURIComponent(abortMatch[1]!),
    );
    return;
  }

  const permissionMatch = pathname.match(
    /^\/sessions\/([^/]+)\/permissions\/([^/]+)$/,
  );
  if (method === "POST" && permissionMatch) {
    await handleRespondPermission(
      req,
      res,
      ctx,
      decodeURIComponent(permissionMatch[1]!),
      decodeURIComponent(permissionMatch[2]!),
    );
    return;
  }

  sendError(res, 404, `not found: ${method} ${pathname}`);
}
