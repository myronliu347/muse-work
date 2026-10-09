import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import { loadMuseSettings, patchMuseSettings } from "../services/museSettings.js";
import {
  readMuseUserSettingsText,
  MuseSettingsJsonError,
  writeMuseUserSettingsText,
} from "../services/museAgentSettings.js";

export const settingsRoutes = new Hono<HonoEnv>();

settingsRoutes.get("/settings", (c) => {
  const ctx = c.get("ctx");
  return c.json(loadMuseSettings(ctx.home));
});

/** User-scope agent settings (`~/.muse-work/settings.json`) for the Agent tab. */
settingsRoutes.get("/settings/raw", (c) => {
  const ctx = c.get("ctx");
  try {
    return c.json(readMuseUserSettingsText(ctx.home));
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
    const result = writeMuseUserSettingsText(body.content, ctx.home);
    // Drop identity fingerprints so the *next idle* ensureAgent recreates
    // agents; in-flight turns keep their live agent (see sessionRunner).
    ctx.runner.invalidateAgentIdentities();
    return c.json(result);
  } catch (err) {
    if (err instanceof MuseSettingsJsonError) {
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
    popo?: { groupAssistant?: unknown };
  } | undefined;
  try {
    body = await c.req.json<{
      plugins?: { superpowers?: unknown; mattpocock?: unknown };
      popo?: { groupAssistant?: unknown };
    }>();
  } catch {
    body = undefined;
  }
  const plugins = body?.plugins;
  const groupAssistant = body?.popo?.groupAssistant;
  if (!plugins && groupAssistant === undefined) {
    return c.json({ error: "plugins or popo.groupAssistant is required" }, 400);
  }
  if (plugins) {
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
  }
  if (groupAssistant !== undefined && typeof groupAssistant !== "boolean") {
    return c.json({ error: "popo.groupAssistant must be boolean" }, 400);
  }
  const settings = patchMuseSettings(
    {
      ...(plugins
        ? {
            plugins: {
              superpowers: plugins.superpowers as boolean | undefined,
              mattpocock: plugins.mattpocock as boolean | undefined,
            },
          }
        : {}),
      ...(typeof groupAssistant === "boolean"
        ? { popo: { groupAssistant } }
        : {}),
    },
    ctx.home,
  );
  if (plugins) ctx.runner.invalidateAgentIdentities();
  return c.json(settings);
});
