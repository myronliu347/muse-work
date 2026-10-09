import type { WsEvent } from "../wsEvents.js";
import type { createAssistantMessageLog } from "./messages.js";

type Log = ReturnType<typeof createAssistantMessageLog>;

/** 主人的 POPO 私聊写入对话列表。群消息不记。 */
export function recordPopoMasterInbound(
  log: Log,
  hub: { broadcastAll(event: WsEvent): void },
  event: { from: "popo" | "popo-group"; message: string },
): void {
  if (event.from !== "popo" || !event.message.trim()) return;
  const line = log.append("user", event.message, undefined, "popo");
  hub.broadcastAll({ type: "assistant:chat", line });
}
