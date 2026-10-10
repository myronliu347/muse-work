import { describe, expect, it } from "vitest";
import winston from "winston";
import { REJECT_MESSAGE, createPopoHandler } from "../src/popo/handler.js";
import type { PopoConfig } from "../src/popo/popoConfig.js";
import type { PopoChatEvent } from "../src/popo/handler.js";

const config: PopoConfig = {
  appId: "id",
  appKey: "key",
  appSecret: "secret",
  token: "tk",
  aesKey: "0123456789abcdef0123456789abcdef",
  masterUid: "master@corp.netease.com",
};

const logger = winston.createLogger({ silent: true });

function harness() {
  const sent: Array<{ receiver: string; content: string }> = [];
  const chats: PopoChatEvent[] = [];
  const handler = createPopoHandler({
    config,
    sender: {
      sendText: async (receiver, content) => {
        sent.push({ receiver, content });
      },
    },
    logger,
    onChat: (event) => {
      chats.push(event);
    },
  });
  return { handler, sent, chats };
}

describe("popo handler", () => {
  it("ignores unknown events", async () => {
    const { handler, sent, chats } = harness();
    await handler.handle("IM_OTHER", { from: "master@corp.netease.com", notify: "hi" });
    expect(sent).toEqual([]);
    expect(chats).toEqual([]);
  });

  it("rejects a non-master without enqueueing", async () => {
    const { handler, sent, chats } = harness();
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "other@corp.netease.com",
      notify: "你好",
    });
    expect(sent).toEqual([
      { receiver: "other@corp.netease.com", content: REJECT_MESSAGE },
    ]);
    expect(chats).toEqual([]);
  });

  it("enqueues a master private message without an ack", async () => {
    const { handler, sent, chats } = harness();
    await handler.handle("IM_P2P_TO_ROBOT_MSG", {
      from: "master@corp.netease.com",
      notify: "帮我看看",
    });
    expect(sent).toEqual([]);
    expect(chats).toEqual([
      { from: "popo", message: "帮我看看", user: "master@corp.netease.com" },
    ]);
  });

  it("enqueues a group mention after stripping the @ prefix", async () => {
    const { handler, sent, chats } = harness();
    await handler.handle("IM_CHAT_TO_ROBOT_AT_MSG", {
      from: "master@corp.netease.com",
      sessionId: "8881510",
      notify: "@Muse机器人 看一下这个缺陷",
    });
    expect(sent).toEqual([]);
    expect(chats).toEqual([
      {
        from: "popo-group",
        message: "看一下这个缺陷",
        user: "master@corp.netease.com",
        groupId: "8881510",
      },
    ]);
  });

  it("drops an empty group mention", async () => {
    const { handler, sent, chats } = harness();
    await handler.handle("IM_CHAT_TO_ROBOT_AT_MSG", {
      from: "master@corp.netease.com",
      sessionId: "8881510",
      notify: "@Muse机器人",
    });
    expect(sent).toEqual([]);
    expect(chats).toEqual([]);
  });
});
