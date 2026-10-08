import type { SessionStatus } from "./sessionStore.js";

/** Tool block update payload mirrored from @muse-work/agent callbacks. */
export type ToolUpdateParams = {
  messageId: string;
  id: string;
  name?: string;
  parameters?: string;
  parametersChunk?: string;
  result?: string;
  shortResult?: string;
  success?: boolean;
  error?: string;
  stage?: string;
  [key: string]: unknown;
};

export type WsEvent =
  | {
      type: "message:delta";
      messageId?: string;
      text: string;
      stage?: "streaming" | "end";
    }
  | { type: "message:completed"; messageId?: string }
  | { type: "assistant:message"; messageId: string }
  | {
      type: "user:message";
      /** SDK 真实消息 id（webview 用它对齐乐观气泡的临时 id）。 */
      id?: string;
      content: string;
      images?: Array<{ path: string; mimeType: string }>;
    }
  | {
      type: "reasoning:delta";
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | { type: "tool:update"; params: ToolUpdateParams | Record<string, unknown> }
  | { type: "loading"; loading: boolean }
  | {
      type: "permission:request";
      permissionId: string;
      toolName: string;
      description: string;
      /** Structured tool args for ConfirmationDialog (questions, command, etc.). */
      toolInput?: Record<string, unknown>;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
      permissionMode?: string;
      toolCallId?: string;
    }
  | {
      type: "session:status";
      status: SessionStatus | string;
      error?: string;
      unreadDone?: boolean;
    }
  | { type: "session:unread"; sessionId: string; unreadDone: boolean }
  | { type: "session:titled"; sessionId: string; title: string }
  | { type: "auth:changed"; status: import("@muse-work/provider").AuthStatus }
  | { type: "compaction:state"; isCompacting: boolean }
  | { type: "error:block"; error: string }
  | { type: "messages:replace"; messages: unknown[] }
  | {
      type: "file_history:update";
      messages: Array<{ messageId: string; snapshots: unknown[] }>;
    }
  | {
      type: "subagent:assistant:message";
      subagentId: string;
      messageId: string;
    }
  | {
      type: "subagent:message:delta";
      subagentId: string;
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | {
      type: "subagent:reasoning:delta";
      subagentId: string;
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | {
      type: "subagent:tool:update";
      subagentId: string;
      params: ToolUpdateParams | Record<string, unknown>;
    }
  | {
      type: "subagent:messages";
      subagentId: string;
      messages: unknown[];
    }
  | { type: "tasks:update"; tasks: unknown[] }
  | { type: "background-tasks:update"; tasks: unknown[] }
  | { type: "workflow-runs:update"; runs: unknown[] }
  | { type: "mcp:update"; servers: unknown[] }
  | { type: "updateQueue"; messages: unknown[] }
  | {
      type: "permission-mode";
      mode: "acceptEdits" | "bypassPermissions";
    }
  | { type: "tokens:update"; latestTotalTokens: number }
  | { type: "issue:changed" }
  | { type: "automation:changed" }
  | { type: "popo:changed" }
  | { type: "assistant:chat"; line: { id: string; at: number; role: "user" | "assistant"; message: string } }
  | { type: "assistant:status"; working: boolean };

export type WsBroadcastEvent = WsEvent & { sessionId: string };

export type { SessionStatus };
