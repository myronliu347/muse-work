import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import { loadMuseSettings, patchMuseSettings } from "../services/museSettings.js";

export const settingsRoutes = new Hono<HonoEnv>();

settingsRoutes.get("/settings", (c) => {
  const ctx = c.get("ctx");
  return c.json(loadMuseSettings(ctx.home));
});

settingsRoutes.patch("/settings", async (c) => {
  const ctx = c.get("ctx");
  let body: { plugins?: { superpowers?: unknown } } | undefined;
  try {
    body = await c.req.json<{ plugins?: { superpowers?: unknown } }>();
  } catch {
    body = undefined;
  }
  const superpowers = body?.plugins?.superpowers;
  if (typeof superpowers !== "boolean") {
    return c.json(
      { error: "plugins.superpowers is required and must be boolean" },
      400,
    );
  }
  const settings = patchMuseSettings({ plugins: { superpowers } }, ctx.home);
  ctx.runner.invalidateAgentIdentities();
  return c.json(settings);
});
