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
import { userMessageText } from "./sessionRunner/serialization.js";

const EXEC_REPORT_SUMMARY_MAX = 8_000;
const EXEC_REPORT_PROCESS_MAX = 12_000;

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function lastAssistantText(
  messages: unknown[],
  maxChars = EXEC_REPORT_SUMMARY_MAX,
  includeNested = true,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: string }).role !== "assistant") continue;
    const nestedParts: string[] = [];
    if (includeNested) {
      const blocks = (message as { blocks?: unknown[] }).blocks;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const nested = (block as { nestedMessages?: unknown[] }).nestedMessages;
          if (!Array.isArray(nested) || nested.length === 0) continue;
          const inner = lastAssistantText(nested, maxChars, includeNested);
          if (inner) nestedParts.push(inner);
        }
      }
    }
    const own = userMessageText(message);
    const text = [...nestedParts, own].filter(Boolean).join("\n\n");
    if (!text) continue;
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n…（结论已截断）`;
  }
  return "";
}

function lastTurnMessages(messages: unknown[]): unknown[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: string }).role === "user") {
      return messages.slice(i);
    }
  }
  return messages;
}

function toolStatus(block: Record<string, unknown>): string {
  if (block.success === false || block.isError === true || block.stage === "error") {
    return "失败";
  }
  return "完成";
}

function snapshotPaths(block: Record<string, unknown>): string[] {
  const snapshots = Array.isArray(block.snapshots) ? block.snapshots : [];
  const paths: string[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object") continue;
    const filePath = (snapshot as { path?: unknown }).path;
    if (typeof filePath === "string" && filePath.trim()) {
      paths.push(filePath.trim());
    }
  }
  return paths;
}

function walkTurnProcess(
  messages: unknown[],
  lines: string[],
  prefix: string,
): void {
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: string }).role;
    if (role === "user") continue;
    const blocks = (message as { blocks?: unknown[] }).blocks;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const row = block as Record<string, unknown>;
      if (row.type === "text" && typeof row.content === "string") {
        const text = row.content.trim();
        if (text) lines.push(`${prefix}${text}`);
        continue;
      }
      if (row.type === "tool") {
        const name = typeof row.name === "string" && row.name ? row.name : "tool";
        const detail =
          typeof row.compactParams === "string" && row.compactParams.trim()
            ? ` ${row.compactParams.trim()}`
            : "";
        lines.push(`${prefix}- ${name}${detail}（${toolStatus(row)}）`);
        const nested = row.nestedMessages;
        if (Array.isArray(nested) && nested.length > 0) {
          walkTurnProcess(nested, lines, `${prefix}  `);
        }
        continue;
      }
      if (row.type === "file_history") {
        const files = snapshotPaths(row);
        if (files.length > 0) {
          lines.push(`${prefix}- 改动文件：${files.join(", ")}`);
        }
      }
    }
  }
}

export function lastTurnChangedFiles(messages: unknown[]): string[] {
  const files = new Set<string>();
  function walk(msgs: unknown[]): void {
    for (const message of msgs) {
      if (!message || typeof message !== "object") continue;
      const blocks = (message as { blocks?: unknown[] }).blocks;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        const row = block as Record<string, unknown>;
        if (row.type === "file_history") {
          for (const filePath of snapshotPaths(row)) files.add(filePath);
        }
        const nested = row.nestedMessages;
        if (Array.isArray(nested) && nested.length > 0) walk(nested);
      }
    }
  }
  walk(lastTurnMessages(messages));
  return [...files];
}

export function formatExecTurnProcess(
  messages: unknown[],
  maxChars = EXEC_REPORT_PROCESS_MAX,
): string {
  const lines: string[] = [];
  walkTurnProcess(lastTurnMessages(messages), lines, "");
  const text = lines.join("\n").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…（过程已截断）`;
}

export function formatExecTurnReport(input: {
  itemContent: string;
  ok: boolean;
  error?: string;
  summary?: string;
  files?: string[];
  itemId?: string;
  issueId?: string;
  remaining?: Array<{ id: string; content: string; status: string }>;
  issueStatus?: string;
}): string {
  const idPart = input.itemId?.trim() ? `（itemId：${input.itemId.trim()}）` : "";
  const interrupted = isInterruptedExecResult(input);
  let line: string;
  if (input.ok) {
    line = `清单项「${input.itemContent}」${idPart}本回合结束。系统未将该项标为 done，不能把回合结束当成达标。`;
  } else if (interrupted) {
    line = `清单项「${input.itemContent}」${idPart}已中断，该项仍为 pending。`;
  } else {
    line = `清单项「${input.itemContent}」${idPart}失败${input.error ? `：${input.error}` : "。"}`;
  }
  const parts = [`来源：执行会话`, line];
  const remaining = input.remaining ?? [];
  if (remaining.length > 0) {
    parts.push("");
    parts.push(
      `未完成清单：\n${remaining
        .map((item) => `- ${item.id} 「${item.content}」(${item.status})`)
        .join("\n")}`,
    );
  }
  const summary = input.summary?.trim();
  if (summary) {
    parts.push("", "执行结论：", summary);
  }
  const files = (input.files ?? []).map((filePath) => filePath.trim()).filter(Boolean);
  if (files.length > 0) {
    parts.push("", `本回合改动的文件（若有，供核对，不等于产物只有这些）：\n${files.map((filePath) => `- ${filePath}`).join("\n")}`);
  }
  const issueId = input.issueId?.trim();
  if (issueId) {
    parts.push("");
    parts.push(
      `需要看本回合执行过程时再取（不强制）：node issue.mjs exec-turn --id ${issueId}`,
    );
  }
  parts.push("");
  if (input.issueStatus === "review") {
    parts.push(
      "清单已全部完成，Issue 进入待审核。停止自动 dispatch，向用户汇报。",
    );
  } else if (!input.ok) {
    parts.push(
      "不要只看「本回合结束」。不要 dispatch 下一项。对照清单看产物做到哪（文件或结论均可），对同一 itemId 再 dispatch，--prompt 写明从该处继续。",
    );
  } else {
    parts.push(
      "不要只看「本回合结束」。对照清单原文审核产物：产物不一定是文件，也可能是表格、分析或这段执行结论。有改动文件就去读；没有文件就审结论是否覆盖该项。覆盖才 `items --done` 再 dispatch 下一项；没覆盖或只做了一半：对同一 itemId 再 dispatch。禁止未 --done 就派下一项。工具流水账不强制，拿不准再 exec-turn。",
    );
  }
  return parts.join("\n");
}

export const DUTY_NUDGE_MAX = 3;

export const INTERRUPT_CONTINUE_PROMPT =
  "上次该清单项中断或失败，请从已有进度继续，不要改做其他清单项。";

export function formatDutyNudge(input: {
  remaining: Array<{ id: string; content: string; status: string }>;
  lastItemId?: string;
  lastOk?: boolean;
}): string {
  const remaining = input.remaining
    .map((item) => `- ${item.id} 「${item.content}」(${item.status})`)
    .join("\n");
  const last =
    input.lastItemId && input.lastOk === false
      ? `上一回合中断或失败，必须对同一 itemId 再 dispatch：${input.lastItemId}。禁止派下一项，禁止问用户是否继续。`
      : `上一回合已结束。对照清单审核产物（文件、表格、分析或执行结论均可）后再决定：覆盖则 items --done ${input.lastItemId ?? "该项"} 再派下一项；没覆盖则对同一 itemId 再 dispatch。禁止未 --done 就派下一项，禁止问用户是否继续。`;
  return `来源：系统\nIssue 仍在执行中，清单未完成。不要把控制权交还用户。\n${last}\n\n未完成清单：\n${remaining || "（无）"}`;
}

export function isInterruptedExecResult(result: {
  ok: boolean;
  error?: string;
}): boolean {
  if (result.ok) return false;
  const err = (result.error ?? "").trim();
  if (!err) return true;
  return /interrupt|aborted|中断/i.test(err);
}

function formatExecPrompt(content: string, prompt?: string): string {
  const extra = prompt?.trim();
  const close =
    "若上次该清单项被中断，请从已有进度继续，不要改做其他清单项。最终回复写清做了什么、做到哪。";
  if (extra) {
    return `请执行清单项「${content}」。\n${extra}\n${close}`;
  }
  return `请执行清单项「${content}」。\n${close}`;
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
  getExecTurn(issueId: string): Promise<{
    executionSessionId: string;
    itemId?: string;
    process: string;
    summary: string;
  }>;
} {
  const { issues, sessions, runner, hub } = opts;
  const home = resolveHome(opts.home);
  const inflight = new Map<string, { issueId: string; itemId: string }>();
  const lastOutcome = new Map<string, { itemId: string; ok: boolean }>();
  const dutyNudges = new Map<string, number>();

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
    if (issue.agentMode === "single") {
      throw httpError(409, "单 agent 模式请在本会话实现，不能 dispatch");
    }
    const item = issue.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw httpError(404, "not found");
    }
    const last = lastOutcome.get(issueId);
    if (last && last.itemId !== itemId) {
      const prev = issue.items.find((entry) => entry.id === last.itemId);
      if (prev && prev.status !== "done") {
        throw httpError(
          409,
          last.ok
            ? "上一清单项尚未复核（items --done），不能派下一项"
            : "上一清单项中断或失败，不能派下一项",
        );
      }
    }
    const executionSessionId = ensureExecutionSession(issueId);
    if (inflight.has(executionSessionId)) {
      throw httpError(409, "dispatch already in flight");
    }
    if (issues.get(issueId)?.status === "planning") {
      issues.markExecuting(issueId);
    }
    issues.patchItem(issueId, itemId, { status: "running" });
    dutyNudges.delete(issueId);
    inflight.set(executionSessionId, { issueId, itemId });
    try {
      await runner.sendMessage(
        executionSessionId,
        formatExecPrompt(item.content, prompt),
        undefined,
        "system-inject",
      );
    } catch (err) {
      inflight.delete(executionSessionId);
      issues.patchItem(issueId, itemId, { status: "pending" });
      throw err;
    }
    hub.broadcastAll({ type: "issue:changed" });
    return { executionSessionId };
  }

  function resumePlanningDuty(sessionId: string): void {
    const issue = issues.getByPlanningSession(sessionId);
    if (!issue || issue.status !== "executing") {
      return;
    }
    if (issue.executionSessionId && inflight.has(issue.executionSessionId)) {
      return;
    }
    const remaining = issue.items
      .filter((entry) => entry.status !== "done")
      .map((entry) => ({
        id: entry.id,
        content: entry.content,
        status: entry.status,
      }));
    if (remaining.length === 0) {
      return;
    }
    const last = lastOutcome.get(issue.id);
    if (last && last.ok === false) {
      const same = issue.items.find(
        (entry) => entry.id === last.itemId && entry.status === "pending",
      );
      if (same) {
        void dispatch(issue.id, last.itemId, INTERRUPT_CONTINUE_PROMPT).catch(
          (err: unknown) => {
            getLogger().error("interrupt auto-dispatch failed", {
              issueId: issue.id,
              itemId: last.itemId,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        );
      }
      return;
    }
    const n = dutyNudges.get(issue.id) ?? 0;
    if (n >= DUTY_NUDGE_MAX) {
      return;
    }
    dutyNudges.set(issue.id, n + 1);
    void runner
      .sendMessage(
        sessionId,
        formatDutyNudge({
          remaining,
          lastItemId: last?.itemId,
          lastOk: last?.ok,
        }),
        undefined,
        "system-inject",
      )
      .catch((err: unknown) => {
        getLogger().error("planning duty nudge failed", {
          sessionId,
          issueId: issue.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  function handleTurnSettled(
    sessionId: string,
    result: { ok: boolean; error?: string },
  ): void {
    const mapped = inflight.get(sessionId);
    if (!mapped) {
      resumePlanningDuty(sessionId);
      return;
    }
    inflight.delete(sessionId);
    lastOutcome.set(mapped.issueId, { itemId: mapped.itemId, ok: result.ok });
    issues.patchItem(mapped.issueId, mapped.itemId, { status: "pending" });
    const issue = issues.get(mapped.issueId);
    const item = issue?.items.find((entry) => entry.id === mapped.itemId);
    issues.maybeEnterReview(mapped.issueId);
    if (issue?.planningSessionId) {
      const planningSessionId = issue.planningSessionId;
      void (async () => {
        let summary = "";
        let files: string[] = [];
        try {
          const messages = await runner.getMessages(sessionId);
          summary = lastAssistantText(messages, EXEC_REPORT_SUMMARY_MAX, false);
          files = lastTurnChangedFiles(messages);
        } catch (err: unknown) {
          getLogger().error("execution session messages for report failed", {
            sessionId,
            issueId: mapped.issueId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        const latest = issues.get(mapped.issueId);
        const remaining = (latest?.items ?? [])
          .filter((entry) => entry.status !== "done")
          .map((entry) => ({
            id: entry.id,
            content: entry.content,
            status: entry.status,
          }));
        const report = formatExecTurnReport({
          itemId: mapped.itemId,
          issueId: mapped.issueId,
          itemContent: item?.content ?? "",
          ok: result.ok,
          error: result.error,
          summary,
          files,
          remaining,
          issueStatus: latest?.status,
        });
        await runner.sendMessage(
          planningSessionId,
          report,
          undefined,
          "system-inject",
        );
      })().catch((err: unknown) => {
        getLogger().error("planning session inject failed", {
          sessionId: planningSessionId,
          issueId: mapped.issueId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    hub.broadcastAll({ type: "issue:changed" });
  }

  async function getExecTurn(issueId: string): Promise<{
    executionSessionId: string;
    itemId?: string;
    process: string;
    summary: string;
  }> {
    const issue = issues.get(issueId);
    if (!issue) {
      throw httpError(404, "not found");
    }
    const executionSessionId = issue.executionSessionId;
    if (!executionSessionId) {
      throw httpError(409, "execution session required");
    }
    const messages = await runner.getMessages(executionSessionId);
    return {
      executionSessionId,
      itemId: lastOutcome.get(issueId)?.itemId,
      process: formatExecTurnProcess(messages),
      summary: lastAssistantText(messages),
    };
  }

  return { dispatch, handleTurnSettled, getExecTurn };
}
