import type { SessionStatus } from "./sessionStore.js";

/** Tool block update payload mirrored from wave-agent-sdk callbacks. */
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
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | { type: "message:completed"; messageId?: string }
  | { type: "assistant:message"; messageId: string }
  | {
      type: "reasoning:delta";
      messageId: string;
      text: string;
      stage: "streaming" | "end";
    }
  | { type: "tool:update"; params: ToolUpdateParams }
  | { type: "loading"; loading: boolean }
  | {
      type: "permission:request";
      permissionId: string;
      toolName: string;
      description: string;
    }
  | { type: "session:status"; status: SessionStatus; error?: string }
  | { type: "auth:changed"; status: import("@muse-work/provider").AuthStatus };

export type { SessionStatus };
