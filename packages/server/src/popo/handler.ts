import type winston from "winston";
import type { ChatStore, PopoChatType } from "./chatStore.js";
import type { PopoConfig } from "./popoConfig.js";
import type { PopoAgentFactory } from "./popoAgent.js";
import { TEAM_BTW_IDLE } from "./popoAgent.js";
import type { Sender } from "./sender.js";

export const ACK_MESSAGE = "收到，马上处理，请稍等一会....";
export const REJECT_MESSAGE = "大胆，只有尊敬的大人可以指挥我做事";
/** /clear 控制命令：清空上下文后回复的确认消息 */
export const CLEAR_MESSAGE = "已清空上下文";
export const CLEAR_COMMAND = "/clear";
/** /btw 前缀命令：旁路询问当前进度，问题缺省值 */
export const BTW_COMMAND = "/btw";
export const BTW_DEFAULT_QUESTION = "当前进度如何";

export interface PopoHandler {
  handle(eventType: string, eventData: Record<string, unknown>): Promise<void>;
}

export type PopoHandlerOptions = {
  config: PopoConfig;
  chatStore: ChatStore;
  sender: Sender;
  agentFactory: PopoAgentFactory;
  logger: winston.Logger;
  onChat?: (event: {
    from: "popo" | "popo-group";
    message: string;
    user?: string;
    groupId?: string;
  }) => void;
};

function stripAtMention(notify: string): string {
  return notify.replace(/^@[^\s]+[\s　]*/, "").trim();
}

/** 群消息注入上下文（spec §5.4）：群号 + 引导用 popo-cli 读群历史；P2P 不注入。 */
function buildAgentContent(type: PopoChatType, notify: string, sessionId: string): string {
  const body = type === "team" ? stripAtMention(notify) : notify;
  if (type !== "team") return body;
  return [
    `（本条消息来自群聊，群号 ${sessionId}。若需要群内历史上下文，可用本地 popo-cli / popo-im skill 读取该群消息。）`,
    body,
  ].join("\n");
}

export function createPopoHandler(options: PopoHandlerOptions): PopoHandler {
  const { config, chatStore, sender, agentFactory, logger } = options;

  function toChat(
    eventType: string,
    data: Record<string, unknown>,
  ):
    | { chatKey: string; type: PopoChatType; title: string; receiver: string; from: string; notify: string }
    | undefined {
    const from = String(data.from ?? "");
    const notify = String(data.notify ?? "");
    if (eventType === "IM_P2P_TO_ROBOT_MSG") {
      if (!from) return undefined;
      return { chatKey: `p2p:${from}`, type: "p2p", title: from, receiver: from, from, notify };
    }
    if (eventType === "IM_CHAT_TO_ROBOT_AT_MSG") {
      const sessionId = String(data.sessionId ?? "");
      if (!sessionId) return undefined;
      return {
        chatKey: `team:${sessionId}`,
        type: "team",
        title: `群 ${sessionId}`,
        receiver: sessionId,
        from,
        notify,
      };
    }
    return undefined;
  }

  /** /clear 控制命令：不进入 agent 流程，清 agent 上下文 + 展示历史后回确认。 */
  async function handleClear(
    chatKey: string,
    type: PopoChatType,
    title: string,
    receiver: string,
  ): Promise<void> {
    chatStore.getOrCreateChat(chatKey, type, title);
    try {
      const record = chatStore.getChat(chatKey);
      const runner = await agentFactory(record ?? { chatKey, type });
      await runner.clear?.();
      chatStore.clearMessages(chatKey);
      await sender.sendText(receiver, CLEAR_MESSAGE);
      chatStore.appendMessage(chatKey, {
        role: "assistant",
        content: CLEAR_MESSAGE,
        at: new Date().toISOString(),
        to: receiver,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("popo clear failed", { chatKey, error: message });
      await sender.sendText(receiver, `处理出错：${message}`);
    }
  }

  /** /btw 控制命令：不走 agent 主流程，旁路询问当前进度（p2p 常驻上下文实时回答）。 */
  async function handleBtw(
    chatKey: string,
    type: PopoChatType,
    title: string,
    receiver: string,
    question: string,
  ): Promise<void> {
    chatStore.getOrCreateChat(chatKey, type, title);
    chatStore.appendMessage(chatKey, {
      role: "user",
      content: `${BTW_COMMAND} ${question}`,
      at: new Date().toISOString(),
      to: receiver,
    });
    try {
      const record = chatStore.getChat(chatKey);
      const runner = await agentFactory(record ?? { chatKey, type });
      const reply = await runner.askBtw?.(question) ?? TEAM_BTW_IDLE;
      await sender.sendText(receiver, reply);
      chatStore.appendMessage(chatKey, {
        role: "assistant",
        content: reply,
        at: new Date().toISOString(),
        to: receiver,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("popo btw failed", { chatKey, error: message });
      await sender.sendText(receiver, `处理出错：${message}`);
    }
  }

  return {
    async handle(eventType, eventData) {
      const chat = toChat(eventType, eventData);
      if (!chat) {
        logger.info("popo event ignored", { eventType });
        return;
      }
      const { chatKey, type, title, receiver, from, notify } = chat;

      if (from !== config.masterUid) {
        logger.info("popo rejected non-master", { from });
        await sender.sendText(receiver, REJECT_MESSAGE);
        return;
      }

      // /clear 控制命令：群聊先剥 @提及再精确匹配，命中则不进入 agent 流程。
      const body = type === "team" ? stripAtMention(notify) : notify;
      if (body.trim() === CLEAR_COMMAND) {
        await handleClear(chatKey, type, title, receiver);
        return;
      }

      // /btw 前缀命令：旁路询问当前进度，命中则不进入 agent 主流程。
      // 提取问题：'/btw 进度如何' → '进度如何'；空则用默认问题。
      if (body.trim().startsWith(BTW_COMMAND)) {
        const question = body.trim().slice(BTW_COMMAND.length).trim() || BTW_DEFAULT_QUESTION;
        await handleBtw(chatKey, type, title, receiver, question);
        return;
      }

      if (options.onChat) {
        options.onChat({
          from: type === "team" ? "popo-group" : "popo",
          message: body,
          user: from,
          ...(type === "team" ? { groupId: receiver } : {}),
        });
        return;
      }

      await sender.sendText(receiver, ACK_MESSAGE);
      chatStore.getOrCreateChat(chatKey, type, title);
      chatStore.appendMessage(chatKey, {
        role: "user",
        content: notify,
        at: new Date().toISOString(),
        from,
      });

      // 处理中标记：详情页据此展示"处理中"状态；无论成败最后都清除。
      chatStore.setProcessing(chatKey, true);
      try {
        const record = chatStore.getChat(chatKey);
        const content = buildAgentContent(type, notify, type === "team" ? receiver : "");
        const runner = await agentFactory(record ?? { chatKey, type });
        const reply = await runner.run(content);
        if (reply.trim()) {
          await sender.sendText(receiver, reply);
          chatStore.appendMessage(chatKey, {
            role: "assistant",
            content: reply,
            at: new Date().toISOString(),
            to: receiver,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("popo agent failed", { chatKey, error: message });
        await sender.sendText(receiver, `处理出错：${message}`);
      } finally {
        chatStore.setProcessing(chatKey, false);
      }
    },
  };
}
