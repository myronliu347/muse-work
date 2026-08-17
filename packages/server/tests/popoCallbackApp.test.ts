import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCallbackApp } from "../src/popo/callbackApp.js";
import { encryptEvent } from "../src/popo/crypt.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";

const config: PopoConfig = {
  appId: "id",
  appKey: "key",
  appSecret: "secret",
  token: "test-token",
  aesKey: crypto.randomBytes(32).toString("base64").slice(0, 43),
  masterUid: "master@corp.netease.com",
};

/** 真实协议（2026-08-17 实测校准）：signature = SHA256(sort(token,timestamp,nonce).join(""))，在 query。 */
function sign(timestamp: string, nonce: string): string {
  const sorted = [config.token, timestamp, nonce].sort().join("");
  return crypto.createHash("sha256").update(sorted).digest("hex");
}

function makeHandler() {
  const events: Array<{ eventType: string; eventData: unknown }> = [];
  return {
    events,
    handler: {
      handle: async (eventType: string, eventData: Record<string, unknown>) => {
        events.push({ eventType, eventData });
      },
    },
  };
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

async function post(
  app: ReturnType<typeof createCallbackApp>,
  encrypt: string,
  timestamp: string,
  nonce: string,
): Promise<Response> {
  const req = new Request(
    `http://0.0.0.0:3100/popo/callback?timestamp=${timestamp}&nonce=${nonce}&signature=${sign(timestamp, nonce)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encrypt }),
    },
  );
  return app.fetch(req);
}

describe("popo callback app", () => {
  it("GET handshake echoes echostr with valid signature", async () => {
    const app = createCallbackApp({ config, handler: makeHandler().handler, logger });
    const echostr = "hello123";
    const timestamp = "1700000000";
    const nonce = "n1";
    // 注：hono 4.13 的 app.fetch 只接受 Request（传字符串会崩在 getPath），此处与 post() 一致包一层。
    const res = await app.fetch(
      new Request(
        `http://x/popo/callback?timestamp=${timestamp}&nonce=${nonce}&echostr=${echostr}&signature=${sign(timestamp, nonce)}`,
      ),
    );
    expect(await res.text()).toBe("hello123");
  });

  it("POST decrypts a valid event and dispatches to handler", async () => {
    const { events, handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const event = { eventType: "IM_P2P_TO_ROBOT_MSG", eventData: { from: "a@b", notify: "hi" } };
    const encrypt = encryptEvent(config.aesKey, JSON.stringify(event));
    const res = await post(app, encrypt, "1700000001", "n2");
    expect(await res.json()).toEqual({ code: 0, msg: "ok" });
    expect(events).toEqual([event]);
  });

  it("POST rejects bad signature", async () => {
    const { handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const req = new Request(
      `http://0.0.0.0:3100/popo/callback?timestamp=1&nonce=2&signature=badsig`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ encrypt: "AAAA" }),
      },
    );
    const res = await app.fetch(req);
    expect(res.status).toBe(401);
  });

  it("POST rejects missing fields", async () => {
    const { handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const req = new Request("http://0.0.0.0:3100/popo/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
  });

  it("POST rejects JSON literal null as invalid json (400)", async () => {
    const { handler } = makeHandler();
    const app = createCallbackApp({ config, handler, logger });
    const req = new Request("http://0.0.0.0:3100/popo/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(400);
    expect((await res.json()) as { msg: string }).toMatchObject({ msg: "invalid json" });
  });
});
