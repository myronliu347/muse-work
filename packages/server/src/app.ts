import http from "node:http";
import type { AppContext } from "./createAppContext.js";
import { sendError } from "./http.js";
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthStatus,
} from "./routes/auth.js";
import { handleHealth } from "./routes/health.js";
import {
  handleListModels,
  handleListProviders,
  handleSetActive,
} from "./routes/providers.js";

export function createApp(ctx: AppContext): http.Server {
  return http.createServer((req, res) => {
    void routeRequest(req, res, ctx).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendError(res, 500, message);
      } else {
        res.end();
      }
    });
  });
}

async function routeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/health") {
    await handleHealth(req, res);
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

  sendError(res, 404, `not found: ${method} ${pathname}`);
}
