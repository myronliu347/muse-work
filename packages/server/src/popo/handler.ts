import type winston from "winston";
import type { PopoConfig } from "./popoConfig.js";
import type { Sender } from "./sender.js";

export const REJECT_MESSAGE = "大胆，只有尊敬的大人可以指挥我做事";

export interface PopoHandler {
  handle(eventType: string, eventData: Record<string, unknown>): Promise<void>;
}

export type PopoChatEvent = {
  from: "popo" | "popo-group";
  message: string;
  user?: string;
  groupId?: string;
};

export type PopoHandlerOptions = {
  config: PopoConfig;
  sender: Sender;
  logger: winston.Logger;
  onChat: (event: PopoChatEvent) => void;
};

function stripAtMention(notify: string): string {
  return notify.replace(/^@[^\s]+[\s　]*/, "").trim();
}

export function createPopoHandler(options: PopoHandlerOptions): PopoHandler {
  const { config, sender, logger, onChat } = options;

  return {
    async handle(eventType, eventData) {
      const from = String(eventData.from ?? "");
      const notify = String(eventData.notify ?? "");
      let receiver = "";
      let body = "";
      let event: PopoChatEvent | undefined;

      if (eventType === "IM_P2P_TO_ROBOT_MSG") {
        if (!from) {
          logger.info("popo event ignored", { eventType });
          return;
        }
        receiver = from;
        body = notify.trim();
        event = { from: "popo", message: body, user: from };
      } else if (eventType === "IM_CHAT_TO_ROBOT_AT_MSG") {
        const sessionId = String(eventData.sessionId ?? "");
        if (!sessionId) {
          logger.info("popo event ignored", { eventType });
          return;
        }
        receiver = sessionId;
        body = stripAtMention(notify);
        event = {
          from: "popo-group",
          message: body,
          user: from,
          groupId: sessionId,
        };
      } else {
        logger.info("popo event ignored", { eventType });
        return;
      }

      if (from !== config.masterUid) {
        logger.info("popo rejected non-master", { from });
        await sender.sendText(receiver, REJECT_MESSAGE);
        return;
      }

      if (!body) return;
      onChat(event);
    },
  };
}
