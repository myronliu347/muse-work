import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import type { Issue, IssueAgentMode, IssuePriority } from "../services/issueStore.js";
import {
  runnerErrorMessage,
  runnerErrorStatus,
} from "../utils/runnerError.js";
import { openIssueSession } from "../services/issueOpen.js";

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

/** POST /issues */
issuesRoutes.post("/issues", async (c) => {
  const ctx = c.get("ctx");
  let body: {
    title?: string;
    description?: string;
    priority?: IssuePriority;
    tags?: string[];
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
      tags: body.tags,
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

/** POST /issues/:id/ready — single agent marks the task done, still active */
issuesRoutes.post("/issues/:id/ready", (c) => {
  const ctx = c.get("ctx");
  const existing = ctx.issueStore.get(c.req.param("id"));
  if (!existing) return c.json({ error: "not found" }, 404);
  if (isTerminal(existing.status)) return c.json({ error: "issue is terminal" }, 409);
  try {
    const issue = ctx.issueStore.markReady(existing.id);
    if (!issue) return c.json({ error: "conflict" }, 409);
    broadcastIssueChanged(ctx);
    return c.json({ issue });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      409,
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
    const issue = ctx.issueStore.acceptItem(id, itemId);
    if (!issue) {
      return c.json({ error: "not found" }, 404);
    }
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

