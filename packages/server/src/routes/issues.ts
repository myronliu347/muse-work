import { Hono } from "hono";
import { DEFAULT_ACTIVE_MODEL_ID } from "@muse-work/provider";
import type { HonoEnv } from "../honoEnv.js";
import type { Issue, IssuePriority, ChecklistItemStatus } from "../services/issueStore.js";
import {
  runnerErrorMessage,
  runnerErrorStatus,
} from "../utils/runnerError.js";
import {
  buildSystemPrompt,
  resolveAgent,
  resolvePermission,
  resolveScenarioAgent,
} from "../services/agentConfig.js";
import { getLogger } from "../utils/logger.js";

export const issuesRoutes = new Hono<HonoEnv>();

function broadcastIssueChanged(ctx: { hub: { broadcastAll: (e: { type: "issue:changed" }) => void } }) {
  ctx.hub.broadcastAll({ type: "issue:changed" });
}

function isTerminal(status: Issue["status"]): boolean {
  return status === "completed" || status === "cancelled";
}

/** GET /issues — active issues only. */
issuesRoutes.get("/issues", (c) => {
  const ctx = c.get("ctx");
  return c.json({ issues: ctx.issueStore.listActive() });
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

/** POST /issues */
issuesRoutes.post("/issues", async (c) => {
  const ctx = c.get("ctx");
  let body: {
    title?: string;
    description?: string;
    priority?: IssuePriority;
    tags?: string[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  try {
    const issue = ctx.issueStore.create({
      title: body.title ?? "",
      description: body.description,
      priority: body.priority,
      tags: body.tags,
    });
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
    Pick<Issue, "title" | "description" | "priority" | "tags">
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

/** POST /issues/:id/complete — cancelled → 409 */
issuesRoutes.post("/issues/:id/complete", (c) => {
  const ctx = c.get("ctx");
  const issue = ctx.issueStore.complete(c.req.param("id"));
  if (!issue) {
    return c.json({ error: "conflict" }, 409);
  }
  broadcastIssueChanged(ctx);
  return c.json({ issue });
});

/** POST /issues/:id/cancel — completed → 409 */
issuesRoutes.post("/issues/:id/cancel", (c) => {
  const ctx = c.get("ctx");
  const issue = ctx.issueStore.cancel(c.req.param("id"));
  if (!issue) {
    return c.json({ error: "conflict" }, 409);
  }
  broadcastIssueChanged(ctx);
  return c.json({ issue });
});

/** POST /issues/:id/planning-session — open or reuse planning session */
issuesRoutes.post("/issues/:id/planning-session", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.issueStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (isTerminal(existing.status)) {
    return c.json({ error: "issue is terminal" }, 409);
  }
  if (existing.planningSessionId) {
    return c.json({
      sessionId: existing.planningSessionId,
      workdir: existing.workdir,
    });
  }

  let body: {
    workdir?: string;
    worktreeEnabled?: boolean;
    baseBranch?: string;
    worktreeName?: string;
    worktreeBranch?: string;
    worktreeRepoRoot?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const workdir =
    typeof body.workdir === "string" ? body.workdir.trim() : "";
  if (!workdir) {
    return c.json({ error: "workdir required" }, 400);
  }
  const worktreeEnabled = Boolean(body.worktreeEnabled);

  const agentKey = resolveScenarioAgent("issue-plan", ctx.home);
  const agent = resolveAgent(agentKey, ctx.home);
  const permission = resolvePermission(agent.permission);
  const model = agent.model ?? DEFAULT_ACTIVE_MODEL_ID;
  if (!model) {
    return c.json({ error: "no active model selected" }, 400);
  }
  const systemPrompt = buildSystemPrompt(agent);
  const session = ctx.store.create({
    workdir,
    model,
    title: existing.title,
    worktreeName:
      typeof body.worktreeName === "string" ? body.worktreeName : undefined,
    worktreeBranch:
      typeof body.worktreeBranch === "string" ? body.worktreeBranch : undefined,
    baseBranch:
      typeof body.baseBranch === "string" ? body.baseBranch : undefined,
    worktreeRepoRoot:
      typeof body.worktreeRepoRoot === "string"
        ? body.worktreeRepoRoot
        : undefined,
    agentName: agent.key,
    systemPrompt,
    fastModel: agent.fastModel,
    tools: agent.tools,
    disallowedTools:
      permission.disallowedTools.length > 0
        ? permission.disallowedTools
        : undefined,
    allowedTools:
      permission.allowedTools.length > 0 ? permission.allowedTools : undefined,
  });
  getLogger().info("issue planning session created", {
    issueId: id,
    sessionId: session.id,
    workdir: session.workdir,
    agentName: session.agentName,
  });

  const updated = ctx.issueStore.setPlanning(id, {
    planningSessionId: session.id,
    workdir,
    worktreeEnabled,
    baseBranch:
      typeof body.baseBranch === "string" ? body.baseBranch : undefined,
  });
  if (!updated) {
    return c.json({ error: "conflict" }, 409);
  }
  broadcastIssueChanged(ctx);
  return c.json({ sessionId: session.id, workdir });
});

function parseChecklistStatus(value: unknown): ChecklistItemStatus {
  return value === "running" || value === "done" ? value : "pending";
}

/** PUT /issues/:id/items — replace checklist; missing id → UUID, missing status → pending */
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
  let body: {
    items?: Array<{ id?: string; content?: string; status?: ChecklistItemStatus }>;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (!Array.isArray(body.items)) {
    return c.json({ error: "items required" }, 400);
  }
  const items = [];
  for (const raw of body.items) {
    const content = typeof raw?.content === "string" ? raw.content : "";
    if (!content) {
      return c.json({ error: "item content required" }, 400);
    }
    items.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
      content,
      status: parseChecklistStatus(raw.status),
    });
  }
  const issue = ctx.issueStore.setItems(id, items);
  if (!issue) {
    return c.json({ error: "not found" }, 404);
  }
  broadcastIssueChanged(ctx);
  return c.json({ issue });
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

