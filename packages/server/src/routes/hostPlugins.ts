import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";

export const hostPluginRoutes = new Hono<HonoEnv>();

hostPluginRoutes.get("/host-plugins/settings", (c) => {
  const panels = c.get("ctx").settingsPanels ?? [];
  return c.json({ panels });
});
