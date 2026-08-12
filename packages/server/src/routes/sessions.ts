import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppContext } from "../createAppContext.js";
import { readJsonBody, sendError, sendJson } from "../http.js";

export async function handleCreateSession(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as { workdir?: string } | undefined;
  if (!body?.workdir || typeof body.workdir !== "string") {
    sendError(res, 400, "workdir is required");
    return;
  }
  const session = ctx.store.create(body.workdir);
  sendJson(res, 200, session);
}

export async function handleListSessions(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  sendJson(res, 200, { sessions: ctx.store.list() });
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

export async function handleRespondPermission(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
  sessionId: string,
  permissionId: string,
): Promise<void> {
  const body = (await readJsonBody(req)) as
    | { decision?: "allow" | "deny" }
    | undefined;
  if (body?.decision !== "allow" && body?.decision !== "deny") {
    sendError(res, 400, 'decision must be "allow" or "deny"');
    return;
  }
  try {
    const result = await ctx.runner.respondPermission(
      sessionId,
      permissionId,
      body.decision,
    );
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
