import type { ToolPlugin, ToolResult } from "@muse-work/agent";
import type { IssueStore } from "../../issueStore.js";
import type { SessionStore } from "../../sessionStore.js";
import type { SessionRunner } from "../../sessionRunner/index.js";
import type { AutomationStore } from "../../automationStore.js";
import type { WsHub } from "../../wsHub.js";
import type { createAssistantMessageLog } from "../messages.js";
import { openIssueSession } from "../../issueOpen.js";
import type { ServerWorktree } from "../../gitWorktree.js";
import type { TavilyOptions } from "../tavily.js";

type Log = ReturnType<typeof createAssistantMessageLog>;

export type AssistantToolDeps = {
  home: string;
  issues: IssueStore;
  sessions: SessionStore;
  runner: SessionRunner;
  automations: AutomationStore;
  log: Log;
  hub: WsHub;
  sendText?: (
    receiver: string,
    content: string,
    at?: { atUids?: string[] },
  ) => Promise<string[] | void>;
  sendLocalFile?: (receiver: string, filePath: string) => Promise<string | void>;
  recallPopo?: (args: { msgId: string; sessionId: string; sessionType: 1 | 3 }) => Promise<void>;
  /** 主人账号。只有发给这个人的 POPO 私聊才写入对话列表。 */
  popoMasterUid?: () => string | undefined;
  openIssue?: typeof openIssueSession;
  /** 测试可替换。缺省时服务器自己执行 git worktree add。 */
  createWorktree?: (args: { workdir: string; baseBranch?: string }) => Promise<ServerWorktree>;
  /** 测试可替换 Tavily 的密钥和 fetch。 */
  tavily?: TavilyOptions;
};

export function fail(error: string): ToolResult {
  return { success: false, content: "", error };
}

export function ok(value: unknown): ToolResult {
  return { success: true, content: JSON.stringify(value) };
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function messageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) items.push(trimmed);
  }
  return items;
}

export function compactText(value: unknown, max = 80): string {
  const raw = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!raw) return "";
  const chars = [...raw];
  return chars.length <= max ? raw : `${chars.slice(0, max).join("")}…`;
}

export function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  run: (args: Record<string, unknown>) => Promise<ToolResult>,
  formatCompactParams: (params: Record<string, unknown>) => string,
): ToolPlugin {
  return {
    name,
    config: {
      type: "function",
      function: { name, description, parameters },
    },
    execute: (args) => run(args),
    formatCompactParams: (params) => formatCompactParams(params),
  };
}
