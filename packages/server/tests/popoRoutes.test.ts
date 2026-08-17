import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPopoRoutes } from "../src/popo/routes.js";
import { createChatStore } from "../src/popo/chatStore.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";
import type { PopoRuntime } from "../src/popo/setup.js";

function runtime(): PopoRuntime {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "popo-routes-"));
  const config: PopoConfig = {
    appId: "id",
    appKey: "key",
    appSecret: "secret",
    token: "tk",
    aesKey: "ak",
    masterUid: "master@corp.netease.com",
  };
  const chatStore = createChatStore({ home });
  chatStore.getOrCreateChat("p2p:master@corp.netease.com", "p2p", "master@corp.netease.com");
  chatStore.appendMessage("p2p:master@corp.netease.com", {
    role: "assistant",
    content: "回复内容",
    at: "t1",
  });
  return {
    config,
    chatStore,
    callbackPort: 3100,
    ready: true,
    url: "http://127.0.0.1:3100/popo/callback",
    workdir: "/tmp/popo-routes-workdir",
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

  it("GET /popo/chats lists chats with last message", async () => {
    const app = createPopoRoutes(runtime());
    const res = await app.fetch(new Request("http://x/popo/chats"));
    const body = (await res.json()) as { chats: Array<{ chatKey: string; lastMessage: string }> };
    expect(body.chats[0].chatKey).toBe("p2p:master@corp.netease.com");
    expect(body.chats[0].lastMessage).toBe("回复内容");
  });

  it("GET /popo/chats/:chatKey returns detail or 404", async () => {
    const app = createPopoRoutes(runtime());
    const ok = await app.fetch(new Request("http://x/popo/chats/p2p%3Amaster%40corp.netease.com"));
    expect((await ok.json()) as { chat: { chatKey: string } }).toMatchObject({
      chat: { chatKey: "p2p:master@corp.netease.com" },
    });
    const missing = await app.fetch(new Request("http://x/popo/chats/team%3A999"));
    expect(missing.status).toBe(404);
  });

  it("GET /popo/chats includes processing flag", async () => {
    const rt = runtime();
    rt.chatStore.setProcessing("p2p:master@corp.netease.com", true);
    const app = createPopoRoutes(rt);
    const res = await app.fetch(new Request("http://x/popo/chats"));
    const body = (await res.json()) as { chats: Array<{ chatKey: string; processing: boolean }> };
    expect(body.chats[0]).toMatchObject({ chatKey: "p2p:master@corp.netease.com", processing: true });
  });

  it("GET /popo/chats/:chatKey returns full session messages when waveSessionId exists", async () => {
    const rt = runtime();
    rt.chatStore.setWaveSessionId("p2p:master@corp.netease.com", "wave-s1");
    const app = createPopoRoutes(rt, {
      loadSession: async () => ({
        messages: [
          { id: "m1", role: "user", blocks: [{ type: "text", content: "hi" }] },
          {
            id: "m2",
            role: "assistant",
            blocks: [
              { type: "reasoning", content: "思考中" },
              { type: "tool", name: "bash", result: "ok" },
              { type: "text", content: "最终回复" },
            ],
          },
        ],
      }),
    });
    const res = await app.fetch(new Request("http://x/popo/chats/p2p%3Amaster%40corp.netease.com"));
    const body = (await res.json()) as { chat: { waveSessionId: string }; messages: Array<{ role: string; blocks: unknown[] }> };
    expect(body.chat.waveSessionId).toBe("wave-s1");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].blocks.map((b) => (b as { type: string }).type)).toEqual([
      "reasoning",
      "tool",
      "text",
    ]);
  });

  it("GET /popo/chats/:chatKey falls back to stored text messages without a session", async () => {
    const app = createPopoRoutes(runtime());
    const res = await app.fetch(new Request("http://x/popo/chats/p2p%3Amaster%40corp.netease.com"));
    const body = (await res.json()) as { messages: Array<{ role: string; blocks: Array<{ type: string; content: string }> }> };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      id: "p2p:master@corp.netease.com:0",
      role: "assistant",
      blocks: [{ type: "text", content: "回复内容" }],
    });
  });

  it("degraded runtime (no config/chatStore) serves 200 with ready:false instead of 500", async () => {
    const degraded: PopoRuntime = {
      config: null as unknown as PopoRuntime["config"],
      chatStore: null as unknown as PopoRuntime["chatStore"],
      callbackPort: 3100,
      ready: false,
      error: "popo disabled: config unavailable",
      url: "http://127.0.0.1:3100/popo/callback",
      workdir: "/tmp/popo-routes-workdir",
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
    expect(configBody.aesKey).toBeNull();
    expect(configBody.masterUid).toBeNull();
    expect(configBody.url).toContain("/popo/callback");

    const chatsRes = await app.fetch(new Request("http://x/popo/chats"));
    expect(chatsRes.status).toBe(200);
    expect((await chatsRes.json()) as { chats: unknown[] }).toEqual({ chats: [] });

    const detailRes = await app.fetch(new Request("http://x/popo/chats/p2p%3Amaster%40corp.netease.com"));
    expect(detailRes.status).toBe(404);
  });
});
