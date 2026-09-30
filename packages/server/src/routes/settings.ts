import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import { loadMuseSettings, patchMuseSettings } from "../services/museSettings.js";
import {
  readWaveUserSettingsText,
  WaveSettingsJsonError,
  writeWaveUserSettingsText,
} from "../services/waveAgentSettings.js";

export const settingsRoutes = new Hono<HonoEnv>();

settingsRoutes.get("/settings", (c) => {
  const ctx = c.get("ctx");
  return c.json(loadMuseSettings(ctx.home));
});

/** Wave user-scope agent settings (`~/.muse-work/settings.json`) for the Agent tab. */
settingsRoutes.get("/settings/raw", (c) => {
  const ctx = c.get("ctx");
  try {
    return c.json(readWaveUserSettingsText(ctx.home));
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

settingsRoutes.put("/settings/raw", async (c) => {
  const ctx = c.get("ctx");
  let body: { content?: unknown } | undefined;
  try {
    body = await c.req.json<{ content?: unknown }>();
  } catch {
    body = undefined;
  }
  if (typeof body?.content !== "string") {
    return c.json({ error: "content is required and must be a string" }, 400);
  }
  try {
    const result = writeWaveUserSettingsText(body.content, ctx.home);
    // Drop identity fingerprints so the *next idle* ensureAgent recreates
    // agents; in-flight turns keep their live agent (see sessionRunner).
    ctx.runner.invalidateAgentIdentities();
    return c.json(result);
  } catch (err) {
    if (err instanceof WaveSettingsJsonError) {
      return c.json({ error: err.message }, 400);
    }
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

settingsRoutes.patch("/settings", async (c) => {
  const ctx = c.get("ctx");
  let body: {
    plugins?: { superpowers?: unknown; mattpocock?: unknown };
  } | undefined;
  try {
    body = await c.req.json<{
      plugins?: { superpowers?: unknown; mattpocock?: unknown };
    }>();
  } catch {
    body = undefined;
  }
  const plugins = body?.plugins;
  if (!plugins) {
    return c.json({ error: "plugins is required" }, 400);
  }
  const { superpowers, mattpocock } = plugins;
  if (
    (superpowers !== undefined && typeof superpowers !== "boolean") ||
    (mattpocock !== undefined && typeof mattpocock !== "boolean")
  ) {
    return c.json(
      { error: "plugins fields must be boolean" },
      400,
    );
  }
  const settings = patchMuseSettings(
    { plugins: { superpowers, mattpocock } },
    ctx.home,
  );
  ctx.runner.invalidateAgentIdentities();
  return c.json(settings);
});
