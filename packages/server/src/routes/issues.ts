import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import type { Issue, IssuePriority } from "../services/issueStore.js";

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
