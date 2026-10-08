import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import { normalizeAssistantImages } from "../services/assistant/messages.js";

export const assistantRoutes = new Hono<HonoEnv>();

assistantRoutes.get("/assistant/session", (c) => {
  const session = c
    .get("ctx")
    .store.list()
    .find((item) => item.origin === "assistant");
  if (!session) return c.json({ error: "assistant session not found" }, 404);
  return c.json({
    sessionId: session.id,
    title: session.title,
    workdir: session.workdir,
    working: c.get("ctx").assistantRuntime.working(),
  });
});

assistantRoutes.get("/assistant/queue", (c) => {
  return c.json({ items: c.get("ctx").assistantRuntime.queueItems() });
});

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
  const images = normalizeAssistantImages(
    (body as { images?: unknown }).images,
  );
  if (!message && images.length === 0) {
    return c.json({ error: "message required" }, 400);
  }
  const line = ctx.assistantLog.append(
    "user",
    message,
    images.length > 0 ? images : undefined,
  );
  ctx.hub.broadcastAll({ type: "assistant:chat", line });
  ctx.assistantRuntime.enqueue({
    type: "chat",
    from: "muse",
    message,
    ...(images.length > 0 ? { images } : {}),
  });
  return c.json(line);
});
