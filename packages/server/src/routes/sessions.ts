import type { IncomingMessage, ServerResponse } from "node:http";
import { createDefaultProjectWorkdir, DEFAULT_ACTIVE_MODEL_ID } from "@muse-work/provider";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";
import { getLogger } from "../logger.js";

export async function handleCreateSession(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | {
        workdir?: string;
        model?: string;
        permissionMode?: string;
        worktreeName?: string;
        worktreeBranch?: string;
        baseBranch?: string;
        worktreeRepoRoot?: string;
      }
    | undefined;
  const workdir =
    typeof body?.workdir === "string" && body.workdir.trim().length > 0
      ? body.workdir.trim()
      : createDefaultProjectWorkdir(ctx.home);
  const model =
    typeof body?.model === "string" && body.model.length > 0
      ? body.model
      : DEFAULT_ACTIVE_MODEL_ID;
  if (!model) {
    sendError(res, 400, "no active model selected");
    return;
  }
  const session = ctx.store.create({
    workdir,
    model,
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
  });
  getLogger().info("session created", {
    sessionId: session.id,
    model: session.model,
    workdir: session.workdir,
    worktreeName: session.worktreeName,
  });
  sendJson(res, 200, session);
}

export async function handleListSessions(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.searchParams.get("grouped") === "1") {
    sendJson(res, 200, ctx.store.listGrouped());
    return;
  }
  sendJson(res, 200, {
    sessions: ctx.store.list(),
    activeSessionId: ctx.store.getActiveSessionId(),
  });
}

export async function handlePatchSession(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | {
        title?: string;
        pinned?: boolean;
        model?: string;
        lastActiveAt?: number;
      }
    | undefined;
  if (!body || typeof body !== "object") {
    sendError(res, 400, "request body is required");
    return;
  }

  const patch: {
    title?: string;
    pinned?: boolean;
    model?: string;
    lastActiveAt?: number;
  } = {};
  if (typeof body.title === "string") {
    patch.title = body.title;
  }
  if (typeof body.pinned === "boolean") {
    patch.pinned = body.pinned;
  }
  if (typeof body.model === "string") {
    patch.model = body.model;
  }
  if (typeof body.lastActiveAt === "number") {
    patch.lastActiveAt = body.lastActiveAt;
  }

  const session = ctx.store.update(sessionId, patch);
  if (!session) {
    sendError(res, 404, `session not found: ${sessionId}`);
    return;
  }
  sendJson(res, 200, session);
}

export async function handleSelectSession(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.store.get(sessionId);
  if (!session) {
    sendError(res, 404, `session not found: ${sessionId}`);
    return;
  }
  ctx.store.select(sessionId);
  ctx.store.setUnreadDone(sessionId, false);
  getLogger().info("session selected", { sessionId });
  sendJson(res, 200, { session, clearedUnread: true });
}

export async function handleGetMessages(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.store.get(sessionId);
  if (!session) {
    sendError(res, 404, `session not found: ${sessionId}`);
    return;
  }
  const messages = await ctx.runner.getMessages(sessionId);
  sendJson(res, 200, { messages });
}

export async function handleGetSession(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.store.get(sessionId);
  if (!session) {
    sendError(res, 404, `session not found: ${sessionId}`);
    return;
  }
  sendJson(res, 200, session);
}

export async function handleDeleteSession(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const session = ctx.store.get(sessionId);
  if (!session) {
    sendError(res, 404, `session not found: ${sessionId}`);
    return;
  }
  await ctx.runner.disposeSession(sessionId);
  getLogger().info("session deleted", { sessionId });
  sendJson(res, 200, { ok: true });
}

export async function handleSendMessage(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | {
        content?: string;
        images?: Array<{ data?: string; mediaType?: string }>;
      }
    | undefined;
  const content = typeof body?.content === "string" ? body.content : "";
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
    sendError(res, 400, "content or images is required");
    return;
  }
  try {
    const result = await ctx.runner.sendMessage(
      sessionId,
      content,
      images.length > 0 ? images : undefined,
    );
    getLogger().info("message accepted", {
      sessionId,
      chars: content.length,
      images: images.length,
    });
    sendJson(res, 200, result);
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: number }).statusCode)
        : 500;
    const message = err instanceof Error ? err.message : String(err);
    getLogger().warn("message rejected", {
      sessionId,
      status: statusCode || 500,
      error: message,
    });
    sendError(res, statusCode || 500, message);
  }
}

export async function handleAbortMessage(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  try {
    const result = await ctx.runner.abortMessage(sessionId);
    getLogger().info("message aborted", { sessionId });
    sendJson(res, 200, result);
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: number }).statusCode)
        : 500;
    const message = err instanceof Error ? err.message : String(err);
    getLogger().warn("abort failed", {
      sessionId,
      status: statusCode || 500,
      error: message,
    });
    sendError(res, statusCode || 500, message);
  }
}

export async function handleRespondPermission(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
  permissionId: string,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | {
        decision?: "allow" | "deny";
        behavior?: "allow" | "deny";
        message?: string;
        newPermissionMode?: string;
        newPermissionRule?: string;
      }
    | undefined;

  // Prefer structured PermissionDecision fields; keep legacy { decision }.
  const behavior =
    body?.behavior === "allow" || body?.behavior === "deny"
      ? body.behavior
      : body?.decision === "allow" || body?.decision === "deny"
        ? body.decision
        : undefined;
  if (behavior !== "allow" && behavior !== "deny") {
    sendError(
      res,
      400,
      'behavior (or decision) must be "allow" or "deny"',
    );
    return;
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
              | "plan"
              | "dontAsk")
          : undefined,
      newPermissionRule:
        typeof body?.newPermissionRule === "string"
          ? body.newPermissionRule
          : undefined,
    });
    sendJson(res, 200, result);
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? Number((err as { statusCode: number }).statusCode)
        : 500;
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, statusCode || 500, message);
  }
}
