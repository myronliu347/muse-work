import { Hono } from "hono";
import type { PopoRuntime } from "./setup.js";

export function createPopoRoutes(runtime: PopoRuntime): Hono {
  const app = new Hono();

  app.get("/popo/config", (c) =>
    c.json({
      url: runtime.url,
      token: runtime.config?.token ?? null,
      aesKey: runtime.config?.aesKey ?? null,
      masterUid: runtime.config?.masterUid ?? null,
      port: runtime.callbackPort,
      ready: runtime.ready,
      configured: runtime.configured,
      error: runtime.error ?? null,
    }),
  );

  app.post("/popo/notify", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    const raw =
      body && typeof body === "object" && "text" in body
        ? (body as { text: unknown }).text
        : undefined;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return c.json({ error: "text required" }, 400);
    const masterUid = runtime.config?.masterUid?.trim();
    if (!runtime.configured || !runtime.sendText || !masterUid) {
      return c.json({ error: "popo notify unavailable" }, 503);
    }
    try {
      await runtime.sendText(masterUid, text);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 502);
    }
  });

  return app;
}
