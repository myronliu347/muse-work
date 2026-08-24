import type { DesktopSessionEntry, DesktopSessionGroup } from "../../types";
import { DEFAULT_SESSION_MODEL_ID } from "../defaultModel.js";
import type { MuseSession } from "../apiClient.js";

export { DEFAULT_SESSION_MODEL_ID };

export const DEFAULT_TITLE = "新对话";
export const TITLE_MAX_LEN = 40;

export type TreeSession = MuseSession & {
  unreadDone?: boolean;
  running?: boolean;
  waitingConfirmation?: boolean;
};

export function postToWebview(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function truncateTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_TITLE;
  return trimmed.length > TITLE_MAX_LEN
    ? `${trimmed.slice(0, TITLE_MAX_LEN)}…`
    : trimmed;
}

/**
 * Match CodeMaker auth failures that should prompt a re-login dialog:
 * missing/expired credentials, revoked tokens (401), and renew failures.
 * Only the CodeMaker provider produces these error strings.
 */
export function isAuthError(error: string): boolean {
  return /credentials?\s+(missing|expired)|unauthorized|\b401\b|token.*(?:expired|invalid|revoked)/i.test(
    error,
  );
}

export function toEntry(session: TreeSession): DesktopSessionEntry {
  return {
    sessionId: session.id,
    title: session.title || DEFAULT_TITLE,
    lastActiveAt: session.lastActiveAt ?? session.createdAt,
    workdir: session.workdir,
    hasWorktree: Boolean(session.worktreeName),
    worktreeName: session.worktreeName,
    worktreeBranch: session.worktreeBranch,
    worktreeRepoRoot: session.worktreeRepoRoot,
    running: session.running ?? session.status === "running",
    waitingConfirmation: session.waitingConfirmation,
    pinned: session.pinned,
    unreadDone: session.unreadDone,
  };
}

/**
 * Assemble temporary DesktopSessionGroup[] for pin/recent until Task 6 redesigns Sidebar props.
 */
export function buildSidebarModel(grouped: {
  pinned: TreeSession[];
  recent: TreeSession[];
}): DesktopSessionGroup[] {
  return [
    {
      host: "local",
      workdir: "pin",
      sessions: grouped.pinned.map(toEntry),
    },
    {
      host: "local",
      workdir: "recent",
      sessions: grouped.recent.map(toEntry),
    },
  ];
}

export function mergeRuntimeFields(
  sessions: MuseSession[],
  prevById: Map<string, TreeSession>,
): TreeSession[] {
  return sessions.map((s) => {
    const prev = prevById.get(s.id);
    return {
      ...s,
      unreadDone: prev?.unreadDone ?? s.unreadDone,
      // Prefer API status so refresh clears sticky local running.
      running: s.status === "running",
      waitingConfirmation: prev?.waitingConfirmation,
    };
  });
}

export type PendingPermission = {
  permissionId: string;
  toolName: string;
  description: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  permissionMode?: string;
  toolCallId?: string;
};

export function confirmationTypeForTool(toolName: string): string {
  switch (toolName) {
    case "AskUserQuestion":
      return "问题待回答";
    case "Bash":
      return "Bash 命令执行确认";
    case "Edit":
    case "Write":
      return "代码修改确认";
    case "ExitPlanMode":
      return "计划执行确认";
    case "EnterPlanMode":
      return "进入计划模式确认";
    default:
      if (toolName.startsWith("mcp__")) return "MCP 工具确认";
      return "工具确认";
  }
}

/** Normalize WS toolInput; fall back to parsing description when older servers omit it. */
export function resolveToolInput(pending: PendingPermission): Record<string, unknown> {
  if (pending.toolInput && typeof pending.toolInput === "object") {
    return pending.toolInput;
  }
  const prefix = `${pending.toolName}: `;
  if (pending.description.startsWith(prefix)) {
    try {
      const parsed: unknown = JSON.parse(
        pending.description.slice(prefix.length),
      );
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  // Legacy hostBridge stored the bare command string as description for Bash.
  if (pending.toolName === "Bash" && pending.description.trim()) {
    return { command: pending.description };
  }
  return {};
}

/** Normalize a permission mode for the webview; only bypassPermissions is special. */
export function emitPermissionMode(mode: string | undefined): void {
  const normalized =
    mode === "bypassPermissions" ? "bypassPermissions" : "acceptEdits";
  postToWebview({ command: "updatePermissionMode", mode: normalized });
}

export function emitCompacting(isCompacting: boolean): void {
  postToWebview({
    command: "compactionStateChange",
    isCompacting,
  });
}

export function showServerToast(message: string): void {
  postToWebview({
    command: "showToast",
    toast: { id: "muse-server", message },
  });
}
