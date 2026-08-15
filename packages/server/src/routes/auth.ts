import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";

function getActiveProvider(ctx: HonoEnv["Variables"]["ctx"]) {
  const { providerId } = ctx.registry.getActive();
  const provider = ctx.registry.get(providerId);
  if (!provider) {
    return undefined;
  }
  return provider;
}

export const authRoutes = new Hono<HonoEnv>();

authRoutes.get("/auth/status", async (c) => {
  const ctx = c.get("ctx");
  const provider = getActiveProvider(ctx);
  if (!provider) {
    return c.json({ error: "active provider not found" }, 404);
  }
  return c.json(await provider.getAuthStatus());
});

authRoutes.post("/auth/login", async (c) => {
  const ctx = c.get("ctx");
  const provider = getActiveProvider(ctx);
  if (!provider) {
    return c.json({ error: "active provider not found" }, 404);
  }

  let body: { wait?: boolean; complete?: boolean } | undefined;
  try {
    body = await c.req.json<{ wait?: boolean; complete?: boolean }>();
  } catch {
    body = undefined;
  }
  const wait = Boolean(body?.wait || body?.complete);

  if (wait) {
    try {
      return c.json(await provider.completeLogin({}));
    } catch {
      // Single-shot wait:true (no prior authUrl call): begin then complete.
    }
    const start = await provider.beginLogin({ openBrowser: () => {} });
    if ("reused" in start && start.reused) {
      return c.json(await provider.getAuthStatus());
    }
    return c.json(await provider.completeLogin({}));
  }

  const start = await provider.beginLogin({ openBrowser: () => {} });
  return c.json(start);
});

authRoutes.post("/auth/logout", async (c) => {
  const ctx = c.get("ctx");
  const provider = getActiveProvider(ctx);
  if (!provider) {
    return c.json({ error: "active provider not found" }, 404);
  }
  await provider.logout();
  return c.json({ ok: true });
});
