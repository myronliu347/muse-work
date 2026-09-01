import { DEFAULT_ACTIVE_MODEL_ID } from "@muse-work/provider";
import type { IssueStore } from "./issueStore.js";
import type { SessionStore } from "./sessionStore.js";
import type { SessionRunner } from "./sessionRunner/index.js";
import type { WsHub } from "./wsHub.js";
import {
  buildSystemPrompt,
  resolveAgent,
  resolvePermission,
  resolveScenarioAgent,
} from "./agentConfig.js";
import { resolveHome } from "../utils/paths.js";
import { getLogger } from "../utils/logger.js";

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function formatExecTurnReport(input: {
  itemContent: string;
  ok: boolean;
  error?: string;
}): string {
  const line = input.ok
    ? `清单项「${input.itemContent}」已完成。`
    : `清单项「${input.itemContent}」失败${input.error ? `：${input.error}` : "。"}`;
  return `来源：执行会话\n${line}`;
}

function formatExecPrompt(content: string, prompt?: string): string {
  const extra = prompt?.trim();
  if (extra) {
    return `请执行清单项「${content}」。\n${extra}`;
  }
  return `请执行清单项「${content}」。`;
}

export function createIssueDispatcher(opts: {
  issues: IssueStore;
  sessions: SessionStore;
  runner: SessionRunner;
  hub: WsHub;
  home?: string;
}): {
  dispatch(
    issueId: string,
    itemId: string,
    prompt?: string,
  ): Promise<{ executionSessionId: string }>;
  handleTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void;
} {
  const { issues, sessions, runner, hub } = opts;
  const home = resolveHome(opts.home);
  const inflight = new Map<string, { issueId: string; itemId: string }>();

  function ensureExecutionSession(issueId: string): string {
    const issue = issues.get(issueId);
    if (!issue) {
      throw httpError(404, "not found");
    }
    if (issue.executionSessionId) {
      const existing = sessions.get(issue.executionSessionId);
      if (existing) {
        return existing.id;
      }
    }
    if (!issue.planningSessionId) {
      throw httpError(409, "planning session required");
    }
    const planning = sessions.get(issue.planningSessionId);
    if (!planning) {
      throw httpError(409, "planning session required");
    }
    const agentKey = resolveScenarioAgent("issue-exec", home);
    const agent = resolveAgent(agentKey, home);
    const permission = resolvePermission(agent.permission);
    const model = agent.model ?? DEFAULT_ACTIVE_MODEL_ID;
    if (!model) {
      throw httpError(400, "no active model selected");
    }
    const created = sessions.create({
      workdir: planning.workdir,
      model,
      permissionMode: "bypassPermissions",
      title: `${issue.title} · 执行`,
      worktreeName: planning.worktreeName,
      worktreeBranch: planning.worktreeBranch,
      baseBranch: planning.baseBranch,
      worktreeRepoRoot: planning.worktreeRepoRoot,
      agentName: agent.key,
      systemPrompt: buildSystemPrompt(agent),
      fastModel: agent.fastModel,
      tools: agent.tools,
      disallowedTools:
        permission.disallowedTools.length > 0
          ? permission.disallowedTools
          : undefined,
      allowedTools:
        permission.allowedTools.length > 0 ? permission.allowedTools : undefined,
    });
    issues.setExecutionSessionId(issueId, created.id);
    return created.id;
  }

  async function dispatch(
    issueId: string,
    itemId: string,
    prompt?: string,
  ): Promise<{ executionSessionId: string }> {
    const issue = issues.get(issueId);
    if (!issue) {
      throw httpError(404, "not found");
    }
    if (issue.status === "completed" || issue.status === "cancelled") {
      throw httpError(409, "issue is terminal");
    }
    if (!issue.planningSessionId) {
      throw httpError(409, "planning session required");
    }
    const item = issue.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw httpError(404, "not found");
    }
    const executionSessionId = ensureExecutionSession(issueId);
    if (inflight.has(executionSessionId)) {
      throw httpError(409, "dispatch already in flight");
    }
    if (issues.get(issueId)?.status === "planning") {
      issues.markExecuting(issueId);
    }
    issues.patchItem(issueId, itemId, { status: "running" });
    inflight.set(executionSessionId, { issueId, itemId });
    await runner.sendMessage(
      executionSessionId,
      formatExecPrompt(item.content, prompt),
      undefined,
      "system-inject",
    );
    hub.broadcastAll({ type: "issue:changed" });
    return { executionSessionId };
  }

  function handleTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void {
    const mapped = inflight.get(sessionId);
    if (!mapped) {
      return;
    }
    inflight.delete(sessionId);
    issues.patchItem(mapped.issueId, mapped.itemId, {
      status: result.ok ? "done" : "pending",
    });
    const issue = issues.get(mapped.issueId);
    const item = issue?.items.find((entry) => entry.id === mapped.itemId);
    issues.maybeEnterReview(mapped.issueId);
    if (issue?.planningSessionId) {
      const report = formatExecTurnReport({
        itemContent: item?.content ?? "",
        ok: result.ok,
        error: result.error,
      });
      void runner
        .sendMessage(issue.planningSessionId, report, undefined, "system-inject")
        .catch((err: unknown) => {
          getLogger().error("planning session inject failed", {
            sessionId: issue.planningSessionId,
            issueId: mapped.issueId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
    hub.broadcastAll({ type: "issue:changed" });
  }

  return { dispatch, handleTurnSettled };
}
