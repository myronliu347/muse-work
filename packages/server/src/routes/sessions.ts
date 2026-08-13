import type { IncomingMessage, ServerResponse } from "node:http";
import { createDefaultProjectWorkdir } from "@muse-work/provider";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";

export async function handleCreateSession(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | { workdir?: string; model?: string; permissionMode?: string }
    | undefined;
  const workdir =
    typeof body?.workdir === "string" && body.workdir.trim().length > 0
      ? body.workdir.trim()
      : createDefaultProjectWorkdir(ctx.home);
  const active = ctx.registry.getActive();
  const model =
    typeof body?.model === "string" && body.model.length > 0
      ? body.model
      : active.modelId;
  if (!model) {
    sendError(res, 400, "no active model selected");
    return;
  }
  const session = ctx.store.create({
    workdir,
    model,
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
  sendJson(res, 200, { ok: true });
}

export async function handleSendMessage(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  const body = (await readJsonBody(req)) as { content?: string } | undefined;
  if (!body?.content || typeof body.content !== "string") {
    sendError(res, 400, "content is required");
    return;
  }
  try {
    const result = await ctx.runner.sendMessage(sessionId, body.content);
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

export async function handleAbortMessage(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
): Promise<void> {
  try {
    const result = await ctx.runner.abortMessage(sessionId);
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
