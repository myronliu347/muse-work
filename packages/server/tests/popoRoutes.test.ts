import { describe, expect, it } from "vitest";
import { createPopoRoutes } from "../src/popo/routes.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";
import type { PopoRuntime } from "../src/popo/setup.js";

function runtime(): PopoRuntime {
  const config: PopoConfig = {
    appId: "id",
    appKey: "key",
    appSecret: "secret",
    token: "tk",
    aesKey: "ak",
    masterUid: "master@corp.netease.com",
  };
  return {
    config,
    callbackPort: 3100,
    ready: true,
    url: "http://127.0.0.1:3100/popo/callback",
    configured: true,
  };
}

describe("popo routes", () => {
  it("GET /popo/config exposes config and readiness", async () => {
    const app = createPopoRoutes(runtime());
    const res = await app.fetch(new Request("http://x/popo/config"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.url).toContain("/popo/callback");
    expect(body.token).toBe("tk");
    expect(body.aesKey).toBe("ak");
    expect(body.masterUid).toBe("master@corp.netease.com");
    expect(body.ready).toBe(true);
    expect(body.configured).toBe(true);
  });

  it("degraded runtime serves config with ready:false", async () => {
    const degraded: PopoRuntime = {
      config: null as unknown as PopoRuntime["config"],
      callbackPort: 3100,
      ready: false,
      error: "popo disabled: config unavailable",
      url: "http://127.0.0.1:3100/popo/callback",
      configured: false,
    };
    const app = createPopoRoutes(degraded);
    const configRes = await app.fetch(new Request("http://x/popo/config"));
    expect(configRes.status).toBe(200);
    const configBody = (await configRes.json()) as Record<string, unknown>;
    expect(configBody.configured).toBe(false);
    expect(configBody.ready).toBe(false);
    expect(configBody.error).toBeTruthy();
    expect(configBody.token).toBeNull();
  });

  it("POST /popo/notify sends text to masterUid and ignores receiver", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const rt = runtime();
    rt.sendText = async (receiver, content) => {
      sent.push({ receiver, content });
    };
    const app = createPopoRoutes(rt);
    const res = await app.fetch(
      new Request("http://x/popo/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "巡检完成",
          receiver: "other@corp.netease.com",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toEqual([
      { receiver: "master@corp.netease.com", content: "巡检完成" },
    ]);
  });

  it("POST /popo/notify rejects empty text with 400", async () => {
    const rt = runtime();
    rt.sendText = async () => {};
    const app = createPopoRoutes(rt);
    const res = await app.fetch(
      new Request("http://x/popo/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "  " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /popo/notify returns 503 when POPO is not configured", async () => {
    const degraded: PopoRuntime = {
      config: null as unknown as PopoRuntime["config"],
      callbackPort: 3100,
      ready: false,
      error: "popo disabled: config unavailable",
      url: "http://127.0.0.1:3100/popo/callback",
      configured: false,
    };
    const app = createPopoRoutes(degraded);
    const res = await app.fetch(
      new Request("http://x/popo/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it("POST /popo/notify returns 502 when send fails", async () => {
    const rt = runtime();
    rt.sendText = async () => {
      throw new Error("POPO send-msg 失败: 1 boom");
    };
    const app = createPopoRoutes(rt);
    const res = await app.fetch(
      new Request("http://x/popo/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/boom/);
  });
});
