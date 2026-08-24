export function toSerializableWorkflowRuns(runs: unknown): unknown[] {
  const list = Array.isArray(runs) ? runs : [];
  return list.map((run) => {
    if (!run || typeof run !== "object") return run;
    const { completionPromise: _drop, ...rest } = run as Record<
      string,
      unknown
    >;
    const phases = Array.isArray(rest.phases) ? rest.phases : [];
    const meta =
      rest.meta && typeof rest.meta === "object"
        ? rest.meta
        : { name: "", description: "" };
    return { ...rest, phases, meta };
  });
}

export function toBackgroundTaskSummary(task: {
  id?: string;
  type?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  command?: string;
  description?: string;
  exitCode?: number;
  runtime?: number;
  outputPath?: string;
}): Record<string, unknown> {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    startTime: task.startTime,
    ...(task.endTime !== undefined ? { endTime: task.endTime } : {}),
    ...(task.command !== undefined ? { command: task.command } : {}),
    ...(task.description !== undefined ? { description: task.description } : {}),
    ...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
    ...(task.runtime !== undefined ? { runtime: task.runtime } : {}),
    ...(task.outputPath !== undefined ? { outputPath: task.outputPath } : {}),
  };
}

/** SDK SlashCommand 剥离 handler/immediate 函数后下发前端（前端只需 id/name/description）。 */
export function toSerializableSlashCommand(
  command: unknown,
): { id: string; name: string; description: string } {
  const c = (command ?? {}) as {
    id?: unknown;
    name?: unknown;
    description?: unknown;
  };
  return {
    id: String(c.id ?? c.name ?? ""),
    name: String(c.name ?? c.id ?? ""),
    description: c.description == null ? "" : String(c.description),
  };
}

export function isRewindTargetMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as {
    role?: string;
    isMeta?: boolean;
    id?: string;
    blocks?: Array<{ type?: string; source?: string }>;
  };
  if (m.role !== "user" || m.isMeta || typeof m.id !== "string" || !m.id) {
    return false;
  }
  const blocks = Array.isArray(m.blocks) ? m.blocks : [];
  if (blocks.some((block) => block.type === "bang")) return false;
  if (blocks.some((block) => block.type === "task_notification")) return false;
  if (blocks.some((block) => block.type === "text" && block.source === "hook")) {
    return false;
  }
  return true;
}

export function userMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const blocks = (message as { blocks?: Array<{ type?: string; content?: string }> })
    .blocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => block.type === "text" || block.type === "compact")
    .map((block) => block.content || "")
    .join("")
    .trim();
}

export function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as {
    status?: number;
    statusCode?: number;
    message?: string;
  };
  if (e.status === 401 || e.statusCode === 401) {
    return true;
  }
  if (typeof e.message === "string" && /\b401\b|unauthorized/i.test(e.message)) {
    return true;
  }
  return false;
}

export function isAbortError(err: unknown): boolean {
  if (typeof err === "string") {
    return /aborted/i.test(err);
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError") {
    return true;
  }
  return typeof e.message === "string" && /aborted/i.test(e.message);
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
