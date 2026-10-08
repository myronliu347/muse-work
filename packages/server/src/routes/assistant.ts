import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";

export const assistantRoutes = new Hono<HonoEnv>();

assistantRoutes.get("/assistant/messages", (c) => {
  const before = c.req.query("before") || undefined;
  const limitRaw = Number(c.req.query("limit") ?? "50");
  const page = c.get("ctx").assistantLog.page({
    before,
    limit: Number.isFinite(limitRaw) ? limitRaw : 50,
  });
  return c.json(page);
});

assistantRoutes.post("/assistant/messages", async (c) => {
  const ctx = c.get("ctx");
  let body: { message?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return c.json({ error: "message required" }, 400);
  const line = ctx.assistantLog.append("user", message);
  ctx.hub.broadcastAll({ type: "assistant:chat", line });
  ctx.assistantRuntime.enqueue({ type: "chat", from: "muse", message });
  return c.json(line);
});
