import type winston from "winston";
import type { ChatStore, PopoChatType } from "./chatStore.js";
import type { PopoConfig } from "./popoConfig.js";
import type { PopoAgentFactory } from "./popoAgent.js";
import type { Sender } from "./sender.js";

export const ACK_MESSAGE = "收到，马上处理，请稍等一会....";
export const REJECT_MESSAGE = "大胆，只有尊敬的大人可以指挥我做事";

export interface PopoHandler {
  handle(eventType: string, eventData: Record<string, unknown>): Promise<void>;
}

export type PopoHandlerOptions = {
  config: PopoConfig;
  chatStore: ChatStore;
  sender: Sender;
  agentFactory: PopoAgentFactory;
  logger: winston.Logger;
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
