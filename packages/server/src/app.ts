import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { AppContext } from "./services/appContext.js";
import type { HonoEnv } from "./honoEnv.js";
import { getLogger } from "./utils/logger.js";
import { accessLog } from "./middleware/accessLog.js";
import { injectCtx } from "./middleware/injectCtx.js";
import { authRoutes } from "./routes/auth.js";
import { agentsRoutes } from "./routes/agents.js";
import { controlRoutes } from "./routes/control.js";
import { healthRoutes } from "./routes/health.js";
import { createProvidersRoutes } from "./routes/providers.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { skillsRoutes } from "./routes/skills.js";
import { createSkillMarketRoutes } from "./routes/skillMarket.js";
import { settingsRoutes } from "./routes/settings.js";
import { issuesRoutes } from "./routes/issues.js";
import { automationsRoutes } from "./routes/automations.js";
import { assistantRoutes } from "./routes/assistant.js";
import { hostPluginRoutes } from "./routes/hostPlugins.js";

export function createHonoApp(ctx: AppContext): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.use("*", injectCtx(ctx));
  app.use("*", accessLog);

  app.route("/", healthRoutes);
  app.route("/", settingsRoutes);
  app.route("/", controlRoutes);
  app.route("/", createProvidersRoutes(ctx));
  app.route("/", authRoutes);
  app.route("/", agentsRoutes);
  app.route("/", sessionsRoutes);
  app.route("/", skillsRoutes);
  app.route(
    "/",
    createSkillMarketRoutes({
      onInstalled: async () => {
        ctx.runner.invalidateSkillsListCache();
        const { refreshAllSkillCatalogs } = await import("@muse-work/agent");
        await refreshAllSkillCatalogs();
      },
    }),
  );
  app.route("/", issuesRoutes);
  app.route("/", automationsRoutes);
  app.route("/", assistantRoutes);
  app.route("/", hostPluginRoutes);

  for (const handle of ctx.pluginRoutes ?? []) {
    app.use("*", async (c, next) => {
      const res = await handle(c.req.raw);
      if (res.status === 404) {
        await next();
        return;
      }
      return res;
    });
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
