import type { MessageRouteContext } from "./context";
import { stripImageSourceMarkers, normalizeUserTextForDedupe } from "../../utils/messageUtils";
import type { Message, ToolBlockUpdateCallbackParams } from "../../types";

export function routeStream(message: any, ctx: MessageRouteContext): boolean {
  const { forThisPane, dispatch, stateRef } = ctx;
  switch (message.command) {
      case "updateMessages":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_MESSAGES",
          payload: message.messages,
          hasMore: message.hasMore,
        });
        break;
      case "prependMessages":
        if (!forThisPane(message)) break;
        dispatch({
          type: "PREPEND_MESSAGES",
          payload: message.messages,
          hasMore: Boolean(message.hasMore),
        });
        break;
      case "appendMessages":
        if (!forThisPane(message)) break;
        dispatch({ type: "APPEND_MESSAGES", payload: message.messages });
        break;
      // Test-only handlers
      case "startStreaming":
        if (!forThisPane(message)) break;
        dispatch({ type: "START_STREAMING" });
        break;
      case "endStreaming":
        if (!forThisPane(message)) break;
        dispatch({ type: "END_STREAMING" });
        break;
      // Incremental update commands for streaming optimization
      case "appendMessage":
        if (!forThisPane(message)) break;
        dispatch({ type: "APPEND_MESSAGE", payload: message.message });
        break;
      // Queued sends (while the AI is busy) skip the optimistic bubble; when
      // the SDK dispatches the queued message it broadcasts user:message.
      // Dedupe against the last user bubble for normal non-queued sends,
      // which already appended the same content locally.
      case "user:message": {
        if (!forThisPane(message)) break;
        const um = message as {
          id?: string;
          content?: string;
          images?: Array<{ path: string; mimeType: string }>;
        };
        // The server extends screenshot sends with [Image source: ...]
        // markers; strip them so dedupe still matches the optimistic bubble
        // and the bubble does not render the marker text.
        const content = stripImageSourceMarkers(um.content ?? "").trim();
        if (!content && !um.images?.length) break;
        const realId =
          typeof um.id === "string" && um.id.length > 0 ? um.id : undefined;
        // 乐观气泡可能已被插队的错误块（如空 turn 提示）或 isMeta SessionStart
        // 提醒压到非最后一条，只比对「最近一条 role=user」会漏掉匹配、重复渲染
        // 同一条用户气泡。向上找最近一条未对齐的乐观气泡做去重。判据是「未对齐
        // 的乐观气泡」而非时间窗：SDK 排队（上轮慢流未结束）或斜杠技能先
        // executeSkill 再 addUserMessage 时，echo 可能在发送数秒后才广播，时间
        // 窗会误判为新消息、重复渲染；而乐观气泡用客户端临时 id（user_/user-
        // 前缀），对齐后变成 SDK 真实 id（msg- 前缀）。所以只有 id 仍为临时前缀、
        // 或已等于本 echo 真实 id（幂等重播）的消息才是去重目标——已对齐的历史
        // 消息（真实 id）不会被误配，连续发送的相同内容也不会被错误合并。
        // isMeta 用户消息（SessionStart hook）不参与匹配，也不打断向上扫描。
        const isOptimisticId = (id: string) =>
          id.startsWith("user_") || id.startsWith("user-");
        let lastMsg: (typeof stateRef.current.messages)[number] | undefined;
        for (let i = stateRef.current.messages.length - 1; i >= 0; i--) {
          const m = stateRef.current.messages[i];
          if (m.role !== "user" || m.isMeta) continue;
          if (
            isOptimisticId(m.id) ||
            (realId != null && m.id === realId)
          ) {
            lastMsg = m;
            break;
          }
          // 已对齐的真实用户消息：停止扫描，避免误配更早的同文乐观气泡。
          break;
        }
        if (
          lastMsg != null &&
          content &&
          lastMsg.blocks?.some(
            (b) =>
              b.type === "text" &&
              (b.content === content ||
                normalizeUserTextForDedupe(b.content ?? "") ===
                  normalizeUserTextForDedupe(content)),
          )
        ) {
          // 命中乐观气泡：把客户端临时 id 对齐成 SDK 真实 id，否则该消息
          // 上的 rewind 按钮会用临时 id 请求服务器 → checkpoint not found
          if (realId && lastMsg.id !== realId) {
            dispatch({
              type: "UPDATE_MESSAGE_ID",
              payload: { from: lastMsg.id, to: realId },
            });
          }
          break;
        }
        const blocks: Message["blocks"] = [];
        if (content) {
          blocks.push({ type: "text", content });
        }
        if (um.images?.length) {
          blocks.push({
            type: "image",
            imageUrls: um.images.map((img) => img.path),
          });
        }
        dispatch({
          type: "APPEND_MESSAGE",
          payload: {
            id:
              realId ??
              `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: "user",
            timestamp: new Date().toISOString(),
            blocks,
          },
        });
        break;
      }
      // Bang message incremental updates. Hosts post the bang params nested
      // under `params` (they contain a `command` field that would otherwise
      // clobber the postMessage command discriminator).
      case "bangMessageAdded":
        if (!forThisPane(message)) break;
        console.log(
          "DBG bangMessageAdded",
          message.params,
          stateRef.current.messages.length,
        );
        dispatch({ type: "APPEND_BANG_MESSAGE", payload: message.params });
        break;
      case "bangMessageUpdated":
        if (!forThisPane(message)) break;
        dispatch({ type: "UPDATE_BANG_MESSAGE", payload: message.params });
        break;
      case "bangMessageCompleted":
        if (!forThisPane(message)) break;
        dispatch({ type: "COMPLETE_BANG_MESSAGE", payload: message.params });
        break;
      case "compactionStateChange":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_COMPACTING",
          payload: message.isCompacting === true,
        });
        break;
      case "updateStreamingContent":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_STREAMING_CONTENT",
          payload: {
            messageId: message.messageId,
            chunk: message.chunk,
            stage: message.stage,
          },
        });
        break;
      case "updateStreamingReasoning":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_STREAMING_REASONING",
          payload: {
            messageId: message.messageId as string,
            chunk: message.chunk as string,
            stage: message.stage as "end" | "streaming",
          },
        });
        break;
      case "updateFileHistory":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_FILE_HISTORY",
          payload: {
            messages: message.messages as Array<{
              messageId: string;
              snapshots: unknown[];
            }>,
          },
        });
        break;
      case "updateToolBlock":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_TOOL_BLOCK",
          payload: message.params as ToolBlockUpdateCallbackParams,
        });
        break;
      case "updateErrorBlock":
        if (!forThisPane(message)) break;
        dispatch({
          type: "APPEND_ERROR_BLOCK",
          payload: { error: message.error },
        });
        break;
      case "appendSubagentMessage":
        if (!forThisPane(message)) break;
        dispatch({
          type: "APPEND_SUBAGENT_MESSAGE",
          payload: {
            subagentId: message.subagentId,
            messageId: message.messageId,
          },
        });
        break;
      case "updateSubagentStreamingContent":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_SUBAGENT_STREAMING_CONTENT",
          payload: {
            subagentId: message.subagentId,
            messageId: message.messageId,
            chunk: message.chunk,
            stage: message.stage,
          },
        });
        break;
      case "updateSubagentToolBlock":
        if (!forThisPane(message)) break;
        dispatch({
          type: "UPDATE_SUBAGENT_TOOL_BLOCK",
          payload: {
            subagentId: message.subagentId,
            params: message.params as ToolBlockUpdateCallbackParams,
          },
        });
        break;
      case "setSubagentMessages":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_SUBAGENT_MESSAGES",
          payload: {
            subagentId: message.subagentId,
            messages: message.messages,
          },
        });
        break;
    default:
      return false;
  }
  return true;
}
