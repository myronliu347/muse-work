import { Hono } from "hono";
import {
  createDefaultProjectWorkdir,
  DEFAULT_ACTIVE_MODEL_ID,
} from "@muse-work/provider";
import type { HonoEnv } from "../honoEnv.js";
import { getLogger } from "../utils/logger.js";
import {
  runnerErrorMessage,
  runnerErrorStatus,
} from "../utils/runnerError.js";
import {
  buildSystemPrompt,
  resolveAgentForScenario,
  resolvePermission,
} from "../services/agentConfig.js";

export const sessionsRoutes = new Hono<HonoEnv>();

sessionsRoutes.get("/sessions", (c) => {
  const ctx = c.get("ctx");
  if (c.req.query("grouped") === "1") {
    const grouped = ctx.store.listGrouped();
    const toGroup = (issue: {
      id: string;
      title: string;
      description?: string;
      priority: string;
      type?: string;
      status: string;
      items: unknown;
      planningSessionId?: string;
      executionSessionId?: string;
      agentMode?: "single" | "split";
      closeNote?: string;
      workdir?: string;
      baseBranch?: string;
    }) => {
      const sessions = [];
      if (issue.planningSessionId) {
        const planning = ctx.store.get(issue.planningSessionId);
        if (planning) sessions.push(planning);
      }
      if (issue.executionSessionId) {
        const execution = ctx.store.get(issue.executionSessionId);
        if (execution) sessions.push(execution);
      }
      return {
        issueId: issue.id,
        title: issue.title,
        description: issue.description ?? "",
        priority: issue.priority,
        type: issue.type,
        status: issue.status,
        items: issue.items,
        planningSessionId: issue.planningSessionId,
        executionSessionId: issue.executionSessionId,
        agentMode: issue.agentMode,
        ...(issue.closeNote ? { closeNote: issue.closeNote } : {}),
        ...(issue.workdir ? { workdir: issue.workdir } : {}),
        ...(issue.baseBranch ? { baseBranch: issue.baseBranch } : {}),
        sessions,
      };
    };
    const issueGroups = ctx.issueStore.listActive().map(toGroup);
    const closedIssueGroups = ctx.issueStore.listClosed().map(toGroup);
    const issueSessionIds = new Set(
      [...issueGroups, ...closedIssueGroups].flatMap((g) =>
        g.sessions.map((s) => s.id),
      ),
    );
    return c.json({
      ...grouped,
      pinned: grouped.pinned.filter((s) => !issueSessionIds.has(s.id)),
      recent: grouped.recent.filter((s) => !issueSessionIds.has(s.id)),
      issueGroups,
      closedIssueGroups,
    });
  }
  return c.json({
    sessions: ctx.store
      .list()
      .filter((s) => s.origin !== "automation" && s.origin !== "assistant"),
    activeSessionId: ctx.store.getActiveSessionId(),
  });
});

sessionsRoutes.post("/sessions", async (c) => {
  const ctx = c.get("ctx");
  let body:
    | {
        workdir?: string;
        model?: string;
        permissionMode?: string;
        worktreeName?: string;
        worktreeBranch?: string;
        baseBranch?: string;
        worktreeRepoRoot?: string;
        systemPrompt?: string;
      }
    | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  const workdir =
    typeof body?.workdir === "string" && body.workdir.trim().length > 0
      ? body.workdir.trim()
      : createDefaultProjectWorkdir(ctx.home);
  const agent = resolveAgentForScenario("session", ctx.home);
  const permission = resolvePermission(agent.permission);
  // model：会话显式传 model 才用，且标记显式（后续切换 agent 时保留）；否则回落 agent.model
  const modelExplicit = typeof body?.model === "string" && body.model.length > 0;
  const model = modelExplicit
    ? (body!.model as string)
    : (agent.model ?? DEFAULT_ACTIVE_MODEL_ID);
  if (!model) {
    return c.json({ error: "no active model selected" }, 400);
  }
  // 显式 systemPrompt 完全接管（标记显式，切换 agent 时保留）；否则人格合成（人格段 + agent.systemPrompt）
  const systemPromptExplicit =
    typeof body?.systemPrompt === "string" && body.systemPrompt.length > 0;
  const systemPrompt = systemPromptExplicit
    ? (body!.systemPrompt as string)
    : buildSystemPrompt(agent);
  const session = ctx.store.create({
    workdir,
    model,
    permissionMode:
      body?.permissionMode === "bypassPermissions" ||
      body?.permissionMode === "acceptEdits"
        ? body.permissionMode
        : undefined,
    worktreeName:
      typeof body?.worktreeName === "string" ? body.worktreeName : undefined,
    worktreeBranch:
      typeof body?.worktreeBranch === "string" ? body.worktreeBranch : undefined,
    baseBranch:
      typeof body?.baseBranch === "string" ? body.baseBranch : undefined,
    worktreeRepoRoot:
      typeof body?.worktreeRepoRoot === "string"
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
    modelExplicit,
    systemPromptExplicit,
  });
  getLogger().info("session created", {
    sessionId: session.id,
    model: session.model,
    workdir: session.workdir,
    worktreeName: session.worktreeName,
    agentName: session.agentName,
  });
  return c.json(session);
});

const session = new Hono<HonoEnv>();

session.get("/", (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const s = ctx.store.get(sessionId);
  if (!s) {
    return c.json({ error: `session not found: ${sessionId}` }, 404);
  }
  return c.json(s);
});

session.patch("/", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  let body:
    | {
        title?: string;
        pinned?: boolean;
        model?: string;
        lastActiveAt?: number;
        permissionMode?: string;
      }
    | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "request body is required" }, 400);
  }

  const patch: {
    title?: string;
    pinned?: boolean;
    model?: string;
    lastActiveAt?: number;
    permissionMode?: "acceptEdits" | "bypassPermissions";
    agentName?: string;
    systemPrompt?: string;
    fastModel?: string;
    tools?: string[];
    disallowedTools?: string[];
    allowedTools?: string[];
    modelExplicit?: boolean;
    systemPromptExplicit?: boolean;
  } = {};
  if (typeof body.title === "string") {
    patch.title = body.title;
  }
  if (typeof body.pinned === "boolean") {
    patch.pinned = body.pinned;
  }
  if (typeof body.model === "string") {
    patch.model = body.model;
    patch.modelExplicit = true;
  }
  if (typeof body.lastActiveAt === "number") {
    patch.lastActiveAt = body.lastActiveAt;
  }
  if (
    body.permissionMode === "acceptEdits" ||
    body.permissionMode === "bypassPermissions"
  ) {
    patch.permissionMode = body.permissionMode;
  }
  const updated = ctx.store.update(sessionId, patch);
  if (!updated) {
    return c.json({ error: `session not found: ${sessionId}` }, 404);
  }
  if (patch.permissionMode) {
    await ctx.runner.setPermissionMode(sessionId, patch.permissionMode);
  }
  return c.json(ctx.store.get(sessionId) ?? updated);
});

session.delete("/", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const s = ctx.store.get(sessionId);
  if (!s) {
    return c.json({ error: `session not found: ${sessionId}` }, 404);
  }
  await ctx.runner.disposeSession(sessionId);
  getLogger().info("session deleted", { sessionId });
  return c.json({ ok: true });
});

session.post("/select", (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const s = ctx.store.get(sessionId);
  if (!s) {
    return c.json({ error: `session not found: ${sessionId}` }, 404);
  }
  ctx.store.select(sessionId);
  ctx.store.setUnreadDone(sessionId, false);
  getLogger().info("session selected", { sessionId });
  return c.json({ session: s, clearedUnread: true });
});

session.get("/messages", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const s = ctx.store.get(sessionId);
  if (!s) {
    return c.json({ error: `session not found: ${sessionId}` }, 404);
  }
  const before = c.req.query("before");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const page = await ctx.runner.getMessagePage(sessionId, {
    ...(before ? { before } : {}),
    ...(limit && Number.isFinite(limit) ? { limit } : {}),
  });
  return c.json(page);
});

session.post("/messages", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  let body:
    | {
        content?: string;
        images?: Array<{ data?: string; mediaType?: string }>;
        source?: string;
      }
    | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  const content = typeof body?.content === "string" ? body.content : "";
  const source = body?.source === "system-inject" ? "system-inject" : "user";
  const images: Array<{ data: string; mediaType: string }> = [];
  if (Array.isArray(body?.images)) {
    for (const img of body.images) {
      if (!img || typeof img.data !== "string" || !img.data) continue;
      images.push({
        data: img.data,
        mediaType:
          typeof img.mediaType === "string" && img.mediaType
            ? img.mediaType
            : "image/png",
      });
    }
  }
  if (!content.trim() && images.length === 0) {
    return c.json({ error: "content or images is required" }, 400);
  }
  if (source === "user") {
    const issue = ctx.issueStore.getBySession(sessionId);
    if (issue?.status === "completed" || issue?.status === "cancelled") {
      return c.json({ error: "issue is closed" }, 409);
    }
    if (issue?.status === "awaiting_close") {
      ctx.issueStore.resume(issue.id);
      ctx.hub.broadcastAll({ type: "issue:changed" });
    }
  }
  try {
    const result = await ctx.runner.sendMessage(
      sessionId,
      content,
      images.length > 0 ? images : undefined,
      source,
    );
    getLogger().info("message accepted", {
      sessionId,
      chars: content.length,
      images: images.length,
    });
    return c.json(result);
  } catch (err) {
    const status = runnerErrorStatus(err);
    const message = runnerErrorMessage(err);
    getLogger().warn("message rejected", {
      sessionId,
      status,
      error: message,
    });
    return c.json({ error: message }, status as 400);
  }
});

session.post("/abort", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const result = await ctx.runner.abortMessage(sessionId);
    getLogger().info("message aborted", { sessionId });
    return c.json(result);
  } catch (err) {
    const status = runnerErrorStatus(err);
    const message = runnerErrorMessage(err);
    getLogger().warn("abort failed", {
      sessionId,
      status,
      error: message,
    });
    return c.json({ error: message }, status as 400);
  }
});

session.delete("/queued-messages/:messageId", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const messageId = c.req.param("messageId")!;
  try {
    const result = await ctx.runner.deleteQueuedMessageById(
      sessionId,
      messageId,
    );
    return c.json(result);
  } catch (err) {
    const status = runnerErrorStatus(err);
    const message = runnerErrorMessage(err);
    getLogger().warn("queued message delete failed", {
      sessionId,
      messageId,
      status,
      error: message,
    });
    return c.json({ error: message }, status as 400);
  }
});

session.patch("/queued-messages/:messageId", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const messageId = c.req.param("messageId")!;
  let body:
    | { text?: string; images?: Array<{ data?: string; mediaType?: string }> }
    | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  const images: Array<{ data: string; mediaType: string }> = [];
  if (Array.isArray(body?.images)) {
    for (const img of body.images) {
      if (!img || typeof img.data !== "string" || !img.data) continue;
      images.push({
        data: img.data,
        mediaType:
          typeof img.mediaType === "string" && img.mediaType
            ? img.mediaType
            : "image/png",
      });
    }
  }
  try {
    const result = await ctx.runner.updateQueuedMessage(sessionId, messageId, {
      content: typeof body?.text === "string" ? body.text : undefined,
      images: images.length > 0 ? images : undefined,
    });
    return c.json(result);
  } catch (err) {
    const status = runnerErrorStatus(err);
    const message = runnerErrorMessage(err);
    getLogger().warn("queued message update failed", {
      sessionId,
      messageId,
      status,
      error: message,
    });
    return c.json({ error: message }, status as 400);
  }
});

session.post("/permissions/:permissionId", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const permissionId = c.req.param("permissionId");
  let body:
    | {
        decision?: "allow" | "deny";
        behavior?: "allow" | "deny";
        message?: string;
        newPermissionMode?: string;
        newPermissionRule?: string;
      }
    | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }

  const behavior =
    body?.behavior === "allow" || body?.behavior === "deny"
      ? body.behavior
      : body?.decision === "allow" || body?.decision === "deny"
        ? body.decision
        : undefined;
  if (behavior !== "allow" && behavior !== "deny") {
    return c.json(
      { error: 'behavior (or decision) must be "allow" or "deny"' },
      400,
    );
  }
  try {
    const result = await ctx.runner.respondPermission(sessionId, permissionId, {
      behavior,
      message: typeof body?.message === "string" ? body.message : undefined,
      newPermissionMode:
        typeof body?.newPermissionMode === "string"
          ? (body.newPermissionMode as
              | "default"
              | "bypassPermissions"
              | "acceptEdits"
              | "dontAsk")
          : undefined,
      newPermissionRule:
        typeof body?.newPermissionRule === "string"
          ? body.newPermissionRule
          : undefined,
    });
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/compact", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    return c.json(await ctx.runner.compact(sessionId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/clear", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    return c.json(await ctx.runner.clear(sessionId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/rewind-checkpoints", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const checkpoints = await ctx.runner.listRewindCheckpoints(sessionId);
    return c.json({ checkpoints });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/rewind", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  let body: { messageId?: string } | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  if (!messageId) {
    return c.json({ error: "messageId is required" }, 400);
  }
  try {
    return c.json(await ctx.runner.rewind(sessionId, messageId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/revert-file-history", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  let body: { messageIds?: unknown; messageId?: string } | undefined;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  // Accept both a single messageId (legacy) and a messageIds array.
  const messageIds = Array.isArray(body?.messageIds)
    ? body.messageIds.filter((id): id is string => typeof id === "string")
    : typeof body?.messageId === "string"
      ? [body.messageId]
      : [];
  if (messageIds.length === 0) {
    return c.json({ error: "messageIds is required" }, 400);
  }
  try {
    return c.json(await ctx.runner.revertFileHistory(sessionId, messageIds));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/slash-commands", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const commands = await ctx.runner.getSlashCommands(sessionId);
    return c.json({ commands });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/status", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    return c.json(await ctx.runner.getStatus(sessionId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/runtime", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    return c.json(await ctx.runner.getRuntimeState(sessionId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/mcp", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const servers = await ctx.runner.getMcpServers(sessionId);
    return c.json({ servers });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/mcp/:name/connect", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const name = c.req.param("name");
  try {
    return c.json(await ctx.runner.connectMcpServer(sessionId, name));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/mcp/:name/disconnect", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const name = c.req.param("name");
  try {
    return c.json(await ctx.runner.disconnectMcpServer(sessionId, name));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/background-tasks", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const tasks = await ctx.runner.getBackgroundTasks(sessionId);
    return c.json({ tasks });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/tasks", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const tasks = await ctx.runner.getTasks(sessionId);
    return c.json({ tasks });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/background-tasks/:taskId/output", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const taskId = c.req.param("taskId");
  try {
    const output = await ctx.runner.getBackgroundTaskOutput(sessionId, taskId);
    return c.json({ output });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/background-tasks/:taskId/stop", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const taskId = c.req.param("taskId");
  try {
    return c.json(await ctx.runner.stopBackgroundTask(sessionId, taskId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.get("/workflows", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  try {
    const runs = await ctx.runner.getWorkflowRuns(sessionId);
    return c.json({ runs });
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

session.post("/workflows/:runId/stop", async (c) => {
  const ctx = c.get("ctx");
  const sessionId = c.req.param("sessionId")!;
  const runId = c.req.param("runId");
  try {
    return c.json(await ctx.runner.stopWorkflowRun(sessionId, runId));
  } catch (err) {
    return c.json(
      { error: runnerErrorMessage(err) },
      runnerErrorStatus(err) as 400,
    );
  }
});

sessionsRoutes.route("/sessions/:sessionId", session);
