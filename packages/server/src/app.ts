import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { AppContext } from "./services/appContext.js";
import type { HonoEnv } from "./honoEnv.js";
import { getLogger } from "./utils/logger.js";
import { accessLog } from "./middleware/accessLog.js";
import { injectCtx } from "./middleware/injectCtx.js";
import { authRoutes } from "./routes/auth.js";
import { controlRoutes } from "./routes/control.js";
import { healthRoutes } from "./routes/health.js";
import { providersRoutes } from "./routes/providers.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { settingsRoutes } from "./routes/settings.js";
import { createTodoRoutes } from "./routes/todos.js";
import { createPopoRoutes } from "./popo/routes.js";

export function createHonoApp(ctx: AppContext): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.use("*", injectCtx(ctx));
  app.use("*", accessLog);

  app.route("/", healthRoutes);
  app.route("/", settingsRoutes);
  app.route("/", controlRoutes);
  app.route("/", providersRoutes);
  app.route("/", authRoutes);
  app.route("/", sessionsRoutes);
  app.route("/", createTodoRoutes(ctx.todoStore, ctx.todoScheduler, ctx.hub));

  if (ctx.popo) {
    app.route("/", createPopoRoutes(ctx.popo));
  }

  app.notFound((c) =>
    c.json({ error: `not found: ${c.req.method} ${c.req.path}` }, 404),
  );

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    getLogger().error("request failed", {
      method: c.req.method,
      path: c.req.path,
      error: message,
    });
    return c.json({ error: message }, 500);
  });

  return app;
}

export function createApp(ctx: AppContext): Server {
  const app = createHonoApp(ctx);
  const server = createServer(getRequestListener(app.fetch));
  ctx.hub.attach(server);
  return server;
}
