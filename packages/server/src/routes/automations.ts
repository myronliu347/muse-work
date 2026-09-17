import { Hono } from "hono";
import type { HonoEnv } from "../honoEnv.js";
import type {
  Automation,
  AutomationPermission,
  AutomationTrigger,
} from "../services/automationStore.js";
import {
  compileSchedule,
  type ScheduleUi,
} from "../services/scheduleCompile.js";

export const automationsRoutes = new Hono<HonoEnv>();

function broadcastAutomationChanged(ctx: {
  hub: { broadcastAll: (e: { type: "automation:changed" }) => void };
}) {
  ctx.hub.broadcastAll({ type: "automation:changed" });
}

function isIncomplete(automation: Automation): boolean {
  return (
    !automation.prompt.trim() ||
    !automation.workdir.trim() ||
    automation.triggers.length === 0
  );
}

function isScheduleUi(value: unknown): value is ScheduleUi {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mode = (value as { mode?: unknown }).mode;
  return mode === "cycle" || mode === "interval" || mode === "once";
}

function validateTriggers(triggers: AutomationTrigger[]): void {
  for (const trigger of triggers) {
    if (trigger.type === "cron") {
      if (typeof trigger.expr !== "string" || !trigger.expr.trim()) {
        throw new Error("invalid cron");
      }
    } else if (trigger.type === "once") {
      if (typeof trigger.at !== "number") {
        throw new Error("invalid once");
      }
    } else if (trigger.type === "issue") {
      if (!Array.isArray(trigger.events) || trigger.events.length === 0) {
        throw new Error("empty events");
      }
      const events = new Set(["created", "review", "completed", "cancelled"]);
      if (trigger.events.some((event) => !events.has(event))) {
        throw new Error("invalid events");
      }
      if (
        trigger.priority !== undefined &&
        trigger.priority !== "p0" &&
        trigger.priority !== "p1" &&
        trigger.priority !== "p2"
      ) {
        throw new Error("invalid priority");
      }
      if (trigger.tags !== undefined) {
        if (
          !Array.isArray(trigger.tags) ||
          trigger.tags.some((tag) => typeof tag !== "string")
        ) {
          throw new Error("invalid tags");
        }
      }
    } else {
      throw new Error("invalid trigger");
    }
  }
}

function parseTriggers(
  body: { schedule?: unknown; triggers?: unknown },
): AutomationTrigger[] | undefined {
  const hasSchedule = body.schedule !== undefined;
  const hasTriggers = body.triggers !== undefined;
  if (!hasSchedule && !hasTriggers) {
    return undefined;
  }
  let triggers: AutomationTrigger[] = [];
  if (hasTriggers) {
    if (!Array.isArray(body.triggers)) {
      throw new Error("invalid triggers");
    }
    triggers = body.triggers as AutomationTrigger[];
  }
  if (hasSchedule) {
    if (!isScheduleUi(body.schedule)) {
      throw new Error("invalid schedule");
    }
    const compiled = compileSchedule(body.schedule);
    triggers = hasTriggers ? [...triggers, compiled] : [compiled];
  }
  validateTriggers(triggers);
  return triggers;
}

function parsePermission(value: unknown): AutomationPermission | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "workspace") {
    throw new Error("unknown permission");
  }
  return value;
}

type AutomationBody = {
  name?: string;
  description?: string;
  enabled?: boolean;
  prompt?: string;
  workdir?: string;
  agentName?: string;
  model?: string;
  permission?: unknown;
  triggers?: unknown;
  schedule?: unknown;
};

automationsRoutes.get("/automations", (c) => {
  const ctx = c.get("ctx");
  return c.json({ automations: ctx.automationStore.list() });
});

automationsRoutes.get("/automations/:id", (c) => {
  const ctx = c.get("ctx");
  const automation = ctx.automationStore.get(c.req.param("id"));
  if (!automation) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ automation });
});

automationsRoutes.get("/automations/:id/runs", (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  if (!ctx.automationStore.get(id)) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ runs: ctx.automationStore.listRuns(id) });
});

automationsRoutes.post("/automations", async (c) => {
  const ctx = c.get("ctx");
  let body: AutomationBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  try {
    const triggers = parseTriggers(body) ?? [];
    const permission = parsePermission(body.permission);
    const enabled = body.enabled === true;
    if (
      enabled &&
      isIncomplete({
        prompt: body.prompt ?? "",
        workdir: body.workdir ?? "",
        triggers,
      } as Automation)
    ) {
      return c.json({ error: "incomplete" }, 400);
    }
    const automation = ctx.automationStore.create({
      name: body.name,
      description: body.description,
      enabled,
      prompt: body.prompt,
      workdir: body.workdir,
      agentName: body.agentName,
      model: body.model,
      permission,
      triggers,
    });
    broadcastAutomationChanged(ctx);
    return c.json({ automation }, 201);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

automationsRoutes.patch("/automations/:id", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.automationStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  let body: AutomationBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  try {
    const triggers = parseTriggers(body);
    const permission = parsePermission(body.permission);
    const patch: Partial<Omit<Automation, "id" | "createdAt">> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.prompt !== undefined) patch.prompt = body.prompt;
    if (body.workdir !== undefined) patch.workdir = body.workdir;
    if (body.agentName !== undefined) patch.agentName = body.agentName;
    if (body.model !== undefined) patch.model = body.model;
    if (permission !== undefined) patch.permission = permission;
    if (triggers !== undefined) patch.triggers = triggers;
    if (body.enabled === true) {
      patch.enabled = true;
    } else if (body.enabled === false) {
      patch.enabled = false;
    }
    const next: Automation = {
      ...existing,
      ...patch,
      triggers: patch.triggers ?? existing.triggers,
    };
    if (next.enabled && isIncomplete(next)) {
      return c.json({ error: "incomplete" }, 400);
    }
    const automation = ctx.automationStore.update(id, patch);
    if (!automation) {
      return c.json({ error: "not found" }, 404);
    }
    broadcastAutomationChanged(ctx);
    return c.json({ automation });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

automationsRoutes.post("/automations/:id/enable", (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.automationStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (isIncomplete(existing)) {
    return c.json({ error: "incomplete" }, 400);
  }
  const automation = ctx.automationStore.setEnabled(id, true);
  if (!automation) {
    return c.json({ error: "not found" }, 404);
  }
  broadcastAutomationChanged(ctx);
  return c.json({ automation });
});

automationsRoutes.post("/automations/:id/disable", (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const automation = ctx.automationStore.setEnabled(id, false);
  if (!automation) {
    return c.json({ error: "not found" }, 404);
  }
  broadcastAutomationChanged(ctx);
  return c.json({ automation });
});

automationsRoutes.post("/automations/:id/run", (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  const existing = ctx.automationStore.get(id);
  if (!existing) {
    return c.json({ error: "not found" }, 404);
  }
  if (!existing.enabled) {
    return c.json({ error: "disabled" }, 403);
  }
  if (isIncomplete(existing)) {
    return c.json({ error: "incomplete" }, 400);
  }
  const run = ctx.automationRuntime.enqueue(id, {
    type: "manual",
    firedAt: Date.now(),
  });
  if (!run) {
    return c.json({ error: "disabled" }, 403);
  }
  return c.json({ run });
});

automationsRoutes.post("/automations/runs/:runId/stop", async (c) => {
  const ctx = c.get("ctx");
  const run = await ctx.automationRuntime.stopRun(c.req.param("runId"));
  if (!run) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ run });
});

automationsRoutes.delete("/automations/:id", async (c) => {
  const ctx = c.get("ctx");
  const id = c.req.param("id");
  if (!ctx.automationStore.get(id)) {
    return c.json({ error: "not found" }, 404);
  }
  const running = ctx.automationStore
    .listRuns(id)
    .filter((run) => run.status === "running");
  for (const run of running) {
    await ctx.automationRuntime.stopRun(run.id);
  }
  if (!ctx.automationStore.remove(id)) {
    return c.json({ error: "not found" }, 404);
  }
  broadcastAutomationChanged(ctx);
  return c.json({ ok: true });
});
