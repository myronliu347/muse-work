import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type winston from "winston";
import { decryptEvent, verifySignature } from "./crypt.js";
import type { PopoHandler } from "./handler.js";
import type { PopoConfig } from "./popoConfig.js";

export type CallbackAppOptions = {
  config: PopoConfig;
  handler: PopoHandler;
  logger: winston.Logger;
  /** 校准期调试落盘：原始请求（body+query）JSONL 追加到该文件；缺省不写。 */
  debugFile?: string;
};

/**
 * POPO 事件订阅回调端点。校准后形态：POST body 为 {"encrypt": "<base64>"}，
 * 验签参数 signature/timestamp/nonce 在 query（signature=SHA256(sort(token,timestamp,nonce))）。
 */
export function createCallbackApp(options: CallbackAppOptions): Hono {
  const { config, handler, logger, debugFile } = options;
  const app = new Hono();

  function dump(raw: string, query: Record<string, string | undefined>): void {
    if (!debugFile) return;
    try {
      fs.mkdirSync(path.dirname(debugFile), { recursive: true });
      fs.appendFileSync(
        debugFile,
        JSON.stringify({ at: new Date().toISOString(), query, body: raw }) + "\n",
        "utf8",
      );
    } catch (error) {
      logger.warn("popo debug dump failed", { error: String(error) });
    }
  }

  app.get("/popo/callback", (c) => {
    const q = c.req.query();
    logger.info("popo callback GET", { query: q });
    const { timestamp, nonce, echostr, signature } = q;
    if (echostr && timestamp && nonce && signature) {
      if (verifySignature({ token: config.token, timestamp, nonce, signature })) {
        return c.text(echostr);
      }
      return c.text("invalid signature", 401);
    }
    return c.json({ code: 0, msg: "ok" });
  });

  app.post("/popo/callback", async (c) => {
    const raw = await c.req.text();
    const query = c.req.query();
    dump(raw, query);
    let payload: { encrypt?: string };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      logger.warn("popo callback invalid json", { raw: raw.slice(0, 500) });
      return c.json({ code: -1, msg: "invalid json" }, 400);
    }
    // JSON 字面量 null 能通过 JSON.parse，但非对象，属性访问前兜底。
    if (typeof payload !== "object" || payload === null) {
      logger.warn("popo callback invalid json", { raw: raw.slice(0, 500) });
      return c.json({ code: -1, msg: "invalid json" }, 400);
    }
    if (!payload.encrypt) {
      logger.warn("popo callback missing fields", {
        keys: Object.keys(payload),
        query,
        contentType: c.req.header("content-type"),
        raw: raw.slice(0, 4096),
      });
      return c.json({ code: -1, msg: "missing fields" }, 400);
    }
    // 真实协议：验签参数在 query（signature/timestamp/nonce），body 只有 encrypt。
    const { signature, timestamp, nonce } = query;
    if (!signature || !timestamp || !nonce) {
      logger.warn("popo callback missing query params", { query });
      return c.json({ code: -1, msg: "missing fields" }, 400);
    }
    const ok = verifySignature({
      token: config.token,
      timestamp,
      nonce,
      signature,
    });
    if (!ok) {
      logger.warn("popo callback bad signature");
      return c.json({ code: -1, msg: "bad signature" }, 401);
    }
    let plain: string;
    try {
      plain = decryptEvent(config.aesKey, payload.encrypt);
    } catch (error) {
      logger.error("popo callback decrypt failed", { error: String(error) });
      return c.json({ code: -1, msg: "decrypt failed" }, 500);
    }
    let event: { eventType?: string; eventData?: Record<string, unknown> };
    try {
      event = JSON.parse(plain) as typeof event;
    } catch {
      logger.error("popo callback event json parse failed", { plain: plain.slice(0, 500) });
      return c.json({ code: -1, msg: "bad event" }, 500);
    }
    // JSON 字面量 null 能通过 JSON.parse，但非对象，属性访问前兜底。
    if (typeof event !== "object" || event === null) {
      logger.error("popo callback event json parse failed", { plain: plain.slice(0, 500) });
      return c.json({ code: -1, msg: "bad event" }, 500);
    }
    if (!event.eventType) {
      logger.warn("popo callback missing eventType", { plain: plain.slice(0, 500) });
      return c.json({ code: 0, msg: "ok" });
    }
    // 回调快速返回：ack 在 handler 内部先发出，agent 流程后台继续。
    const flow = handler.handle(event.eventType, event.eventData ?? {});
    void flow.catch((error) =>
      logger.error("popo handler failed", { error: String(error) }),
    );
    return c.json({ code: 0, msg: "ok" });
  });

  return app;
}
