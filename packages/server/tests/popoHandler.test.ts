import { describe, expect, it } from "vitest";
import {
  ACK_MESSAGE,
  CLEAR_MESSAGE,
  REJECT_MESSAGE,
  createPopoHandler,
} from "../src/popo/handler.js";
import { createChatStore } from "../src/popo/chatStore.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";

const config: PopoConfig = {
  appId: "id",
  appKey: "key",
  appSecret: "secret",
  token: "tk",
  aesKey: "ak",
  masterUid: "master@corp.netease.com",
};

function makeSender(log: Array<{ receiver: string; content: string }>) {
  return { sendText: async (r: string, c: string) => log.push({ receiver: r, content: c }) };
}

describe("popo handler", () => {
  it("rejects non-master with fixed message", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-1" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => "不应被调用" }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "intruder@corp.netease.com",
      notify: "你好",
      sessionType: 1,
    });
    expect(sent).toEqual([{ receiver: "intruder@corp.netease.com", content: REJECT_MESSAGE }]);
  });

  it("sends ack then the agent's final text for master p2p", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-2" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => "最终回复" }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "帮我看看",
      sessionType: 1,
    });
    expect(sent[0]).toEqual({ receiver: "master@corp.netease.com", content: ACK_MESSAGE });
    expect(sent[1]).toEqual({ receiver: "master@corp.netease.com", content: "最终回复" });
  });

  it("strips leading @-mention and injects group context in teams", async () => {
    const fed: string[] = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-3" }),
      sender: makeSender([]) as never,
      agentFactory: async () => ({ run: async (c: string) => { fed.push(c); return "ok"; } }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_CHAT_TO_ROBOT_AT_MSG", {
      from: "master@corp.netease.com",
      notify: "@Muse机器人 看看群里的讨论",
      sessionType: 3,
      sessionId: "1696900",
    });
    expect(fed[0]).toContain("群号 1696900");
    expect(fed[0]).toContain("看看群里的讨论");
    expect(fed[0]).not.toContain("@Muse机器人");
  });

  it("sends error message when agent throws", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-4" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => { throw new Error("模型超时"); } }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "hi",
      sessionType: 1,
    });
    expect(sent[0]).toEqual({ receiver: "master@corp.netease.com", content: ACK_MESSAGE });
    expect(sent[1].content).toContain("处理出错：模型超时");
  });

  it("marks chat processing during the agent run and clears after", async () => {
    const home = "/tmp/popo-handler-test-processing";
    const store = createChatStore({ home });
    const seen: Array<boolean | undefined> = [];
    const handler = createPopoHandler({
      config,
      chatStore: store,
      sender: makeSender([]) as never,
      agentFactory: async (chat) => ({
        run: async () => {
          seen.push(store.getChat(chat.chatKey)?.processing);
          return "最终回复";
        },
      }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "hi",
      sessionType: 1,
    });
    expect(seen).toEqual([true]);
    expect(store.getChat("p2p:master@corp.netease.com")?.processing).toBe(false);
  });

  it("clears processing even when agent throws", async () => {
    const home = "/tmp/popo-handler-test-processing-error";
    const store = createChatStore({ home });
    const handler = createPopoHandler({
      config,
      chatStore: store,
      sender: makeSender([]) as never,
      agentFactory: async () => ({ run: async () => { throw new Error("boom"); } }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "hi",
      sessionType: 1,
    });
    expect(store.getChat("p2p:master@corp.netease.com")?.processing).toBe(false);
  });

  it("ignores unknown event types", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-5" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({ run: async () => "x" }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_USER_RECALL_MSG", { uuid: "u" });
    expect(sent).toEqual([]);
  });

  it("clears context and replies confirmation on /clear without running the agent", async () => {
    const home = "/tmp/popo-handler-test-clear";
    const store = createChatStore({ home });
    const chat = store.getOrCreateChat("p2p:master@corp.netease.com", "p2p", "master@corp.netease.com");
    store.appendMessage(chat.chatKey, { role: "user", content: "之前的问题", at: "t1" });
    const sent: Array<{ receiver: string; content: string }> = [];
    let runCalls = 0;
    let clearCalls = 0;
    const handler = createPopoHandler({
      config,
      chatStore: store,
      sender: makeSender(sent) as never,
      agentFactory: async () => ({
        run: async () => {
          runCalls += 1;
          return "不应被调用";
        },
        clear: async () => {
          clearCalls += 1;
        },
      }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "/clear",
      sessionType: 1,
    });
    expect(clearCalls).toBe(1);
    expect(runCalls).toBe(0);
    // 不经过 ACK，直接回确认消息
    expect(sent).toEqual([{ receiver: "master@corp.netease.com", content: CLEAR_MESSAGE }]);
    // 展示历史已清空，仅剩确认消息
    expect(store.getChat(chat.chatKey)?.messages).toEqual([
      { role: "assistant", content: CLEAR_MESSAGE, at: expect.any(String), to: "master@corp.netease.com" },
    ]);
  });

  it("strips @mention and clears on /clear in teams", async () => {
    const home = "/tmp/popo-handler-test-clear-team";
    const store = createChatStore({ home });
    const sent: Array<{ receiver: string; content: string }> = [];
    let clearCalls = 0;
    const handler = createPopoHandler({
      config,
      chatStore: store,
      sender: makeSender(sent) as never,
      agentFactory: async () => ({
        run: async () => "x",
        clear: async () => {
          clearCalls += 1;
        },
      }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_CHAT_TO_ROBOT_AT_MSG", {
      from: "master@corp.netease.com",
      notify: "@Muse机器人 /clear",
      sessionType: 3,
      sessionId: "1696900",
    });
    expect(clearCalls).toBe(1);
    expect(sent).toEqual([{ receiver: "1696900", content: CLEAR_MESSAGE }]);
    expect(store.getChat("team:1696900")?.messages).toEqual([
      { role: "assistant", content: CLEAR_MESSAGE, at: expect.any(String), to: "1696900" },
    ]);
  });

  it("matches /clear with surrounding whitespace", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    let clearCalls = 0;
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-clear-space" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({
        run: async () => "x",
        clear: async () => {
          clearCalls += 1;
        },
      }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "  /clear  ",
      sessionType: 1,
    });
    expect(clearCalls).toBe(1);
  });

  it("rejects /clear from non-master", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    let clearCalls = 0;
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-clear-nonmaster" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({
        run: async () => "x",
        clear: async () => {
          clearCalls += 1;
        },
      }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "intruder@corp.netease.com",
      notify: "/clear",
      sessionType: 1,
    });
    expect(clearCalls).toBe(0);
    expect(sent).toEqual([{ receiver: "intruder@corp.netease.com", content: REJECT_MESSAGE }]);
  });

  it("sends an error message when clear throws", async () => {
    const sent: Array<{ receiver: string; content: string }> = [];
    const handler = createPopoHandler({
      config,
      chatStore: createChatStore({ home: "/tmp/popo-handler-test-clear-error" }),
      sender: makeSender(sent) as never,
      agentFactory: async () => ({
        run: async () => "x",
        clear: async () => {
          throw new Error("clear boom");
        },
      }),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    });
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "/clear",
      sessionType: 1,
    });
    expect(sent[0].content).toContain("处理出错：clear boom");
  });
});
