import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { HonoEnv } from "../honoEnv.js";
import type { AppContext } from "../services/appContext.js";
import type { Issue, IssueAgentMode, IssuePriority, IssueType } from "../services/issueStore.js";
import {
  runnerErrorMessage,
  runnerErrorStatus,
} from "../utils/runnerError.js";
import { getLogger } from "../utils/logger.js";
import { openIssueSession } from "../services/issueOpen.js";

export const issuesRoutes = new Hono<HonoEnv>();

function broadcastIssueChanged(ctx: { hub: { broadcastAll: (e: { type: "issue:changed" }) => void } }) {
  ctx.hub.broadcastAll({ type: "issue:changed" });
}

/** Give the user a short window before the assistant picks up the close. */
const CLOSE_EVENT_DELAY_MS = process.env.VITEST ? 0 : 5_000;

type PendingClose = {
  previousStatus: import("../services/issueStore.js").IssueStatus;
  timers: NodeJS.Timeout[];
};
const pendingCloses = new Map<string, PendingClose>();

function scheduleIssueClosedEvent(
  ctx: { assistantRuntime: { enqueue: (event: { type: "issue-closed"; issueId: string; title: string; workdir: string; status: "completed" | "cancelled"; timestamp: number }) => void } },
  issue: { id: string; title: string; workdir?: string },
  status: "completed" | "cancelled",
): NodeJS.Timeout | undefined {
  const event = {
    type: "issue-closed" as const,
    issueId: issue.id,
    title: issue.title,
    workdir: issue.workdir ?? "",
    status,
    timestamp: Date.now(),
  };
  if (CLOSE_EVENT_DELAY_MS <= 0) {
    ctx.assistantRuntime.enqueue(event);
    return undefined;
  }
  const timer = setTimeout(() => {
    ctx.assistantRuntime.enqueue(event);
  }, CLOSE_EVENT_DELAY_MS);
  timer.unref?.();
  return timer;
}

function scheduleCloseEffects(
  ctx: Parameters<typeof scheduleIssueClosedEvent>[0] & {
    assistantRuntime: Parameters<typeof scheduleIssueClosedEvent>[0]["assistantRuntime"];
    hub: { broadcastAll: (event: { type: "issue:changed" }) => void };
  },
  issue: Issue,
  status: "completed" | "cancelled",
  previousStatus: import("../services/issueStore.js").IssueStatus,
): void {
  const timers: NodeJS.Timeout[] = [];
  const eventTimer = scheduleIssueClosedEvent(ctx, issue, status);
  if (eventTimer) timers.push(eventTimer);
  const deleteTimer = setTimeout(() => {
    pendingCloses.delete(issue.id);
    void deleteIssueSessions(ctx as Parameters<typeof deleteIssueSessions>[0], issue);
  }, CLOSE_EVENT_DELAY_MS);
  deleteTimer.unref?.();
  timers.push(deleteTimer);
  pendingCloses.set(issue.id, { previousStatus, timers });
}

/**
 * 关闭事项时连带删除它的规划 / 执行会话：会话属于这个事项，关掉后不该再
 * 留在侧栏和会话列表里。磁盘上的 transcript 交给常规保留期清理。
 */
async function deleteIssueSessions(
  ctx: AppContext,
  issue: Pick<Issue, "planningSessionId" | "executionSessionId">,
): Promise<void> {
  const ids = new Set(
    [issue.planningSessionId, issue.executionSessionId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  for (const id of ids) {
    if (!ctx.store.get(id)) continue;
    try {
      await ctx.runner.disposeSession(id);
    } catch (err) {
      getLogger().error("issue session delete failed", {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function isTerminal(status: Issue["status"]): boolean {
  return status === "completed" || status === "cancelled";
}

/** GET /issues — active issues only. */
issuesRoutes.get("/issues", (c) => {
  const ctx = c.get("ctx");
  return c.json({ issues: ctx.issueStore.listActive() });
});

const CLOSED_ISSUE_PAGE_SIZE = 20;

/**
 * GET /issues/closed — completed/cancelled issues, newest first.
 * The detail rail loads these in pages; the grouped tree only carries the
 * first page so a long archive does not get pulled on every session switch.
 */
issuesRoutes.get("/issues/closed", (c) => {
  const ctx = c.get("ctx");
  const offsetRaw = Number(c.req.query("offset") ?? "0");
  const limitRaw = Number(c.req.query("limit") ?? String(CLOSED_ISSUE_PAGE_SIZE));
  const offset = Number.isFinite(offsetRaw)
    ? Math.max(0, Math.floor(offsetRaw))
    : 0;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(100, Math.max(1, Math.floor(limitRaw)))
    : CLOSED_ISSUE_PAGE_SIZE;
  const all = ctx.issueStore.listClosed();
  const issues = all.slice(offset, offset + limit).map((issue) => ({
    issueId: issue.id,
    title: issue.title,
    priority: issue.priority,
    ...(issue.type ? { type: issue.type } : {}),
    status: issue.status,
    ...(issue.closeNote ? { closeNote: issue.closeNote } : {}),
    closedAt: issue.updatedAt,
    ...(issue.workdir ? { workdir: issue.workdir } : {}),
    ...(issue.baseBranch ? { baseBranch: issue.baseBranch } : {}),
  }));
  return c.json({
    issues,
    hasMore: offset + limit < all.length,
    total: all.length,
  });
});

/** GET /issues/:id/exec-turn — last execution turn process, on demand */
issuesRoutes.get("/issues/:id/exec-turn", async (c) => {
  const ctx = c.get("ctx");
  try {
    const turn = await ctx.issueDispatcher.getExecTurn(c.req.param("id"));
    return c.json(turn);
  } catch (err) {
    const status = runnerErrorStatus(err);
    return c.json({ error: runnerErrorMessage(err) }, status as 400);
  }
});

/** GET /issues/:id */
issuesRoutes.get("/issues/:id", (c) => {
  const ctx = c.get("ctx");
  const issue = ctx.issueStore.get(c.req.param("id"));
  if (!issue) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ issue });
});

/** GET /issues/:id/updates — progress history, newest first. */
issuesRoutes.get("/issues/:id/updates", (c) => {
  const ctx = c.get("ctx");
  const issue = ctx.issueStore.get(c.req.param("id"));
  if (!issue) return c.json({ error: "not found" }, 404);
  const limitRaw = Number(c.req.query("limit") ?? "30");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 30;
  return c.json(
    ctx.issueProgress.list(issue.id, {
      limit,
      ...(c.req.query("before") ? { before: c.req.query("before")! } : {}),
    }),
  );
});

/** POST /issues */
issuesRoutes.post("/issues", async (c) => {
  const ctx = c.get("ctx");
  let body: {
    title?: string;
    description?: string;
    priority?: IssuePriority;
    type?: IssueType;
    items?: Array<{ content?: string }>;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const toAdd: Array<{ content: string }> = [];
  if (Array.isArray(body.items) && body.items.length > 0) {
    for (const raw of body.items) {
      const content = typeof raw?.content === "string" ? raw.content.trim() : "";
      if (!content) {
        return c.json({ error: "item content required" }, 400);
      }
      toAdd.push({ content });
    }
  }
  try {
    let issue = ctx.issueStore.create({
      title: body.title ?? "",
      description: body.description,
      priority: body.priority,
      type: body.type,
    });
    if (toAdd.length > 0) {
      issue = ctx.issueStore.appendItems(issue.id, toAdd) ?? issue;
    }
    broadcastIssueChanged(ctx);
    return c.json({ issue }, 201);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/** PATCH /issues/:id — metadata only; terminal → 409 */
issuesRoutes.patch("/issues/:id", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.issueStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (isTerminal(existing.status)) {
    return c.json({ error: "issue is terminal" }, 409);
  }
  let body: Partial<
    Pick<Issue, "title" | "description" | "priority" | "type">
  >;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  try {
    const issue = ctx.issueStore.update(id, body);
    if (!issue) {
      return c.json({ error: "not found" }, 404);
    }
    broadcastIssueChanged(ctx);
    return c.json({ issue });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/** POST /issues/:id/ready — single agent marks the task done, still active */
issuesRoutes.post("/issues/:id/ready", (c) => {
  const ctx = c.get("ctx");
  const existing = ctx.issueStore.get(c.req.param("id"));
  if (!existing) return c.json({ error: "not found" }, 404);
  if (isTerminal(existing.status)) return c.json({ error: "issue is terminal" }, 409);
  try {
    const issue = ctx.issueStore.markReady(existing.id);
    if (!issue) return c.json({ error: "conflict" }, 409);
    ctx.recordIssueUpdate(issue.id, {
      kind: "status",
      summary: "这一轮做完，等你确认",
      status: issue.status,
    });
    broadcastIssueChanged(ctx);
    return c.json({ issue });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      409,
    );
  }
});

async function readCloseNote(c: { req: { json: () => Promise<unknown> } }): Promise<string> {
  try {
    const body = (await c.req.json()) as { note?: unknown };
    return typeof body.note === "string" ? body.note : "";
  } catch {
    return "";
  }
}

/** One-line timeline summary; the full Markdown note stays in detail. */
function plainCloseSummary(note: string): string {
  const plain = note
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*[-*+]\s+/, "")
        .replace(/^\s*\d+\.\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/[*_`>|#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 120) || "已完成";
}

type IssueSummaryCache = { key: string; summary: string };

function issueSummaryCachePath(home: string, issueId: string): string {
  return path.join(home, "db", "issue-summaries", `${encodeURIComponent(issueId)}.json`);
}

function readIssueSummaryCache(
  home: string,
  issueId: string,
  key: string,
): string | undefined {
  try {
    const raw = fs.readFileSync(issueSummaryCachePath(home, issueId), "utf8");
    const parsed = JSON.parse(raw) as Partial<IssueSummaryCache>;
    if (parsed.key === key && typeof parsed.summary === "string") {
      return parsed.summary;
    }
  } catch {
    /* missing or invalid cache */
  }
  return undefined;
}

function writeIssueSummaryCache(
  home: string,
  issueId: string,
  cache: IssueSummaryCache,
): void {
  try {
    const file = issueSummaryCachePath(home, issueId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache), "utf8");
  } catch {
    /* cache is best effort */
  }
}

/** POST /issues/:id/undo-close — 5 秒内撤销完成/取消，保留会话。 */
issuesRoutes.post("/issues/:id/undo-close", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const pending = pendingCloses.get(id);
  if (!pending) return c.json({ error: "undo window closed" }, 409);
  for (const timer of pending.timers) clearTimeout(timer);
  pendingCloses.delete(id);
  const restored = ctx.issueStore.restore(id, pending.previousStatus);
  if (!restored) return c.json({ error: "conflict" }, 409);
  ctx.recordIssueUpdate(id, {
    kind: "status",
    summary: "已撤销关闭，继续处理",
    status: restored.status,
  });
  broadcastIssueChanged(ctx);
  return c.json({ issue: restored });
});

/** POST /issues/:id/complete — note 是结果结论；cancelled → 409 */
issuesRoutes.post("/issues/:id/complete", async (c) => {
  const ctx = c.get("ctx");
  const note = await readCloseNote(c);
  try {
    const current = ctx.issueStore.get(c.req.param("id"));
    if (!current) return c.json({ error: "conflict" }, 409);
    const previousStatus = current.status;
    const issue = ctx.issueStore.complete(c.req.param("id"), note);
    if (!issue) return c.json({ error: "conflict" }, 409);
    ctx.recordIssueUpdate(
      issue.id,
      {
        kind: "result",
        summary: `已完成：${plainCloseSummary(note)}`,
        detail: note.trim(),
        status: "completed",
      },
      { allowClosed: true },
    );
    if (CLOSE_EVENT_DELAY_MS > 0) {
      scheduleCloseEffects(ctx, issue, "completed", previousStatus);
    } else {
      await deleteIssueSessions(ctx, issue);
      scheduleIssueClosedEvent(ctx, issue, "completed");
    }
    broadcastIssueChanged(ctx);
    return c.json({ issue });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/** POST /issues/:id/summary — 旁路问事项 AI 要一段完成总结，不写会话。 */
issuesRoutes.post("/issues/:id/summary", async (c) => {
  const ctx = c.get("ctx");
  const issue = ctx.issueStore.get(c.req.param("id"));
  if (!issue) return c.json({ error: "not found" }, 404);
  if (issue.status === "completed" || issue.status === "cancelled") {
    return c.json({ error: "issue closed" }, 409);
  }
  const latest = ctx.issueProgress.latest(issue.id);
  const cacheKey = [
    latest?.id ?? "empty",
    issue.title,
    issue.description,
  ].join("\0");
  const cached = readIssueSummaryCache(ctx.home, issue.id, cacheKey);
  if (cached) return c.json({ summary: cached });
  const execution = issue.executionSessionId;
  const planning = issue.planningSessionId;
  const sessionId =
    (execution && ctx.store.get(execution)?.status === "running"
      ? execution
      : undefined) ||
    (planning && ctx.store.get(planning)?.status === "running"
      ? planning
      : undefined) ||
    execution ||
    planning;
  if (!sessionId) return c.json({ error: "session not open" }, 409);
  if (!ctx.runner.askBtw) {
    return c.json({ error: "askBtw unavailable" }, 501);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const description = issue.description.trim().slice(0, 2000);
    const summary = (
      await ctx.runner.askBtw(
        sessionId,
        [
          `这条 Issue 的标题是：「${issue.title}」。`,
          description ? `Issue 描述：\n${description}` : "这条 Issue 没有补充描述。",
          "请只给这条 Issue 的最终结论：这件事的答案/结果是什么。",
          "不要复述过程、不要写「我先/我在/我做了」、不要列文件路径或命令；",
          "用 Markdown 写给人看的最终结论；可以用短列表或表格组织，但不要铺过程。",
        ].join("\n"),
        controller.signal,
      )
    ).trim();
    if (!summary) return c.json({ error: "empty summary" }, 502);
    writeIssueSummaryCache(ctx.home, issue.id, { key: cacheKey, summary });
    return c.json({ summary });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

/** POST /issues/:id/cancel — note 是取消原因；completed → 409 */
issuesRoutes.post("/issues/:id/cancel", async (c) => {
  const ctx = c.get("ctx");
  const note = await readCloseNote(c);
  try {
    const current = ctx.issueStore.get(c.req.param("id"));
    if (!current) return c.json({ error: "conflict" }, 409);
    const previousStatus = current.status;
    const issue = ctx.issueStore.cancel(c.req.param("id"), note);
    if (!issue) return c.json({ error: "conflict" }, 409);
    ctx.recordIssueUpdate(
      issue.id,
      {
        kind: "result",
        summary: `已取消：${plainCloseSummary(note)}`,
        detail: note.trim(),
        status: "cancelled",
      },
      { allowClosed: true },
    );
    if (CLOSE_EVENT_DELAY_MS > 0) {
      scheduleCloseEffects(ctx, issue, "cancelled", previousStatus);
    } else {
      await deleteIssueSessions(ctx, issue);
      scheduleIssueClosedEvent(ctx, issue, "cancelled");
    }
    broadcastIssueChanged(ctx);
    return c.json({ issue });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

/** POST /issues/:id/planning-session — open or reuse planning session */
issuesRoutes.post("/issues/:id/planning-session", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  let body: {
    workdir?: string;
    worktreeEnabled?: boolean;
    baseBranch?: string;
    worktreeName?: string;
    worktreeBranch?: string;
    worktreeRepoRoot?: string;
    agentMode?: IssueAgentMode;
  };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const result = openIssueSession(ctx, id, body);
  return c.json(result.json, result.status as 200);
});

/** POST /issues/:id/items — append pending items; never replaces executed ones */
issuesRoutes.post("/issues/:id/items", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.issueStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (isTerminal(existing.status)) {
    return c.json({ error: "issue is terminal" }, 409);
  }
  let body: { items?: Array<{ content?: string }> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: "items required" }, 400);
  }
  const toAdd = [];
  for (const raw of body.items) {
    const content = typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!content) {
      return c.json({ error: "item content required" }, 400);
    }
    toAdd.push({ content });
  }
  const issue = ctx.issueStore.appendItems(id, toAdd);
  if (!issue) {
    return c.json({ error: "not found" }, 404);
  }
  ctx.recordIssueUpdate(issue.id, {
    kind: "checklist",
    summary: `清单新增 ${toAdd.length} 项`,
    status: issue.status,
  });
  broadcastIssueChanged(ctx);
  return c.json({ issue });
});

/** PUT /issues/:id/items — same as POST append (no full replace) */
issuesRoutes.put("/issues/:id/items", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.issueStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (isTerminal(existing.status)) {
    return c.json({ error: "issue is terminal" }, 409);
  }
  let body: { items?: Array<{ content?: string }> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: "items required" }, 400);
  }
  const toAdd = [];
  for (const raw of body.items) {
    const content = typeof raw?.content === "string" ? raw.content.trim() : "";
    if (!content) {
      return c.json({ error: "item content required" }, 400);
    }
    toAdd.push({ content });
  }
  const issue = ctx.issueStore.appendItems(id, toAdd);
  if (!issue) {
    return c.json({ error: "not found" }, 404);
  }
  ctx.recordIssueUpdate(issue.id, {
    kind: "checklist",
    summary: `清单新增 ${toAdd.length} 项`,
    status: issue.status,
  });
  broadcastIssueChanged(ctx);
  return c.json({ issue });
});

/** DELETE /issues/:id/items/:itemId — pending or running (aborts inflight exec) */
issuesRoutes.delete("/issues/:id/items/:itemId", async (c) => {
  const ctx = c.get("ctx");
  try {
    const issue = await ctx.issueDispatcher.cancelItem(
      c.req.param("id"),
      c.req.param("itemId"),
    );
    return c.json({ issue });
  } catch (err) {
    const status = runnerErrorStatus(err);
    return c.json(
      { error: runnerErrorMessage(err) },
      status as 400,
    );
  }
});

/** POST /issues/:id/items/:itemId/accept — planning marks item done after review */
issuesRoutes.post("/issues/:id/items/:itemId/accept", (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const itemId = c.req.param("itemId");
  const existing = ctx.issueStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (isTerminal(existing.status)) {
    return c.json({ error: "issue is terminal" }, 409);
  }
  try {
    const item = existing.items.find((entry) => entry.id === itemId);
    const issue = ctx.issueStore.acceptItem(id, itemId);
    if (!issue) {
      return c.json({ error: "not found" }, 404);
    }
    ctx.recordIssueUpdate(issue.id, {
      kind: "checklist",
      summary: item ? `清单项完成：${item.content}` : "清单项完成",
      status: issue.status,
    });
    broadcastIssueChanged(ctx);
    return c.json({ issue });
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: number }).statusCode)
        : 400;
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      (status === 409 ? 409 : 400) as 409,
    );
  }
});

/** POST /issues/:id/dispatch — run one checklist item on the execution session */
issuesRoutes.post("/issues/:id/dispatch", async (c) => {
  const ctx = c.get("ctx");
  let body: { itemId?: string; prompt?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId) {
    return c.json({ error: "itemId required" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
  try {
    const result = await ctx.issueDispatcher.dispatch(
      c.req.param("id"),
      itemId,
      prompt,
    );
    return c.json(result);
  } catch (err) {
    const status = runnerErrorStatus(err);
    return c.json(
      { error: runnerErrorMessage(err) },
      status as 400,
    );
  }
});

