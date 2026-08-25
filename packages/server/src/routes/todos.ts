import { Hono } from "hono";
import type {
  CommentAuthor,
  CommentKind,
  RunStatus,
  TodoSource,
  TodoPriority,
  TodoStore,
} from "../services/todoStore.js";
import type { TodoScheduler } from "../services/todoScheduler.js";
import type { WsHub } from "../services/wsHub.js";

const VALID_SOURCES: TodoSource[] = ["session", "manual", "popo", "internal"];
const VALID_PRIORITIES: TodoPriority[] = ["p0", "p1", "p2"];
const VALID_COMMENT_AUTHORS: CommentAuthor[] = ["user", "ai", "system"];
const VALID_COMMENT_KINDS: CommentKind[] = ["note", "result"];
const VALID_RUN_STATUSES: RunStatus[] = ["queued", "running", "finished", "canceled"];

function isSource(v: unknown): v is TodoSource {
  return typeof v === "string" && (VALID_SOURCES as string[]).includes(v);
}

function isPriority(v: unknown): v is TodoPriority {
  return typeof v === "string" && (VALID_PRIORITIES as string[]).includes(v);
}

function isCommentAuthor(v: unknown): v is CommentAuthor {
  return typeof v === "string" && (VALID_COMMENT_AUTHORS as string[]).includes(v);
}

function isCommentKind(v: unknown): v is CommentKind {
  return typeof v === "string" && (VALID_COMMENT_KINDS as string[]).includes(v);
}

function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === "string" && (VALID_RUN_STATUSES as string[]).includes(v);
}

function isTags(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Todo/Task REST API（Hono，store 直挂；见 spec 2026-08-21-todo-task-design.md）。
 * 与 sessionsRoutes 不同：不依赖 HonoEnv ctx，直接接收 store（便于测试）。
 * scheduler 可选：提供时启用 enqueue/cancel 执行端点。
 * hub 可选：提供时所有变更广播 todo:changed（webview 联动刷新看板/侧栏 badge，
 * 覆盖对话内 AI 跑 todo.mjs 等非看板 UI 来源的变更）。
 */
export function createTodoRoutes(
  store: TodoStore,
  scheduler?: TodoScheduler,
  hub?: WsHub,
): Hono {
  const app = new Hono();

  /** 变更广播：webview 收到后重拉看板数据 + 刷新侧栏树。 */
  function changed(): void {
    hub?.broadcastAll({ type: "todo:changed" });
  }

  app.get("/todos", (c) => {
    // ?archived=1 → 已完成 todo（看板「已完成」归档视图；已取消不展示）
    if (c.req.query("archived") === "1") {
      return c.json({
        todos: store.listAllTodos().filter((t) => t.status === "completed"),
      });
    }
    return c.json({ todos: store.listTodos() });
  });

  app.get("/todos/:todoId", (c) => {
    const todo = store.getTodo(c.req.param("todoId"));
    if (!todo) return c.json({ error: "todo not found" }, 404);
    return c.json({ todo });
  });

  app.post("/todos", async (c) => {
    let body:
      | { title?: string; description?: string; priority?: string; source?: string; tags?: unknown; workdir?: unknown }
      | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const title = body?.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    if (!body?.source || !isSource(body.source)) {
      return c.json({ error: "source required" }, 400);
    }
    if (body.priority !== undefined && !isPriority(body.priority)) {
      return c.json({ error: "invalid priority" }, 400);
    }
    // workdir 可选：trim 后非空才绑定（空串/纯空白 = 未绑定）
    const workdir =
      typeof body.workdir === "string" && body.workdir.trim()
        ? body.workdir.trim()
        : undefined;
    const todo = store.createTodo({
      title,
      description: body.description,
      priority: body.priority,
      source: body.source,
      tags: isTags(body.tags) ? body.tags : undefined,
      workdir,
    });
    changed();
    return c.json({ todo }, 201);
  });

  app.patch("/todos/:todoId", async (c) => {
    let body:
      | { title?: string; description?: string; priority?: string; tags?: unknown; workdir?: unknown }
      | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const patch: {
      title?: string;
      description?: string;
      priority?: TodoPriority;
      tags?: string[];
      workdir?: string | null;
    } = {};
    if (body?.title !== undefined) patch.title = body.title.trim();
    if (body?.description !== undefined) patch.description = body.description;
    if (body?.priority !== undefined) {
      if (!isPriority(body.priority)) return c.json({ error: "invalid priority" }, 400);
      patch.priority = body.priority;
    }
    if (body?.tags !== undefined) patch.tags = isTags(body.tags) ? body.tags : undefined;
    // workdir：trim 后非空才绑定；空串/纯空白 = 解除绑定（null）
    if (body?.workdir !== undefined) {
      patch.workdir =
        typeof body.workdir === "string" && body.workdir.trim()
          ? body.workdir.trim()
          : null;
    }
    const todoId = c.req.param("todoId");
    const todo = store.updateTodo(todoId, patch);
    if (!todo) {
      // 区分不存在 vs 状态锁定
      if (store.getTodo(todoId)) {
        return c.json({ error: "todo locked (only pending editable)" }, 409);
      }
      return c.json({ error: "todo not found" }, 404);
    }
    // workdir 变更 → 同步规划会话 workdir（仅 planning 会话已创建时生效；已运行 agent 仍用旧目录）
    if (patch.workdir !== undefined) scheduler?.syncPlanningWorkdir(todoId);
    changed();
    return c.json({ todo });
  });

  app.post("/todos/:todoId/cancel", async (c) => {
    const todo = store.cancelTodo(c.req.param("todoId"));
    if (!todo) return c.json({ error: "todo not found" }, 404);
    // 级联取消未完成任务（store 内完成），执行中 task 由 onTurnSettled 跳过
    changed();
    return c.json({ ok: true });
  });

  /** 手动标记 todo 已完成：有 task 未到终态（待执行/执行中/待审核）→ 409。 */
  app.post("/todos/:todoId/complete", (c) => {
    const todoId = c.req.param("todoId");
    if (!store.getTodo(todoId)) return c.json({ error: "todo not found" }, 404);
    const todo = store.completeTodo(todoId);
    if (!todo) {
      return c.json({ error: "todo has unfinished tasks (pending/running/review)" }, 409);
    }
    changed();
    return c.json({ ok: true });
  });

  app.post("/todos/:todoId/tasks", async (c) => {
    const todoId = c.req.param("todoId");
    let body:
      | { title?: string; description?: string; workdir?: string; baseBranch?: string; worktreeEnabled?: unknown }
      | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const title = body?.title?.trim();
    if (!title) return c.json({ error: "title required" }, 400);
    const todo = store.getTodo(todoId);
    if (!todo) return c.json({ error: "todo not found" }, 404);
    // workdir 可选：未传/空白 → 继承 todo 绑定目录；todo 也未绑定 → 必填
    const workdir = body?.workdir?.trim() || todo.workdir;
    if (!workdir) return c.json({ error: "workdir required" }, 400);
    const task = store.createTask(todoId, {
      title,
      description: body?.description,
      workdir,
      ...(body?.baseBranch?.trim() ? { baseBranch: body.baseBranch.trim() } : {}),
      // worktreeEnabled=false → git 项目也直接在原目录执行；缺省=隔离
      ...(body?.worktreeEnabled === false ? { worktreeEnabled: false } : {}),
    });
    changed();
    return c.json({ task }, 201);
  });

  app.get("/todos/:todoId/tasks", (c) => {
    const todoId = c.req.param("todoId");
    if (!store.getTodo(todoId)) return c.json({ error: "todo not found" }, 404);
    return c.json({ tasks: store.listTasks(todoId) });
  });

  app.get("/tasks/:taskId", (c) => {
    const task = store.getTask(c.req.param("taskId"));
    if (!task) return c.json({ error: "task not found" }, 404);
    return c.json({ task });
  });

  app.patch("/tasks/:taskId", async (c) => {
    let body: { title?: string; description?: string; workdir?: string } | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const patch: { title?: string; description?: string } = {};
    if (body?.title !== undefined) patch.title = body.title.trim();
    if (body?.description !== undefined) patch.description = body.description;
    const task = store.updateTask(c.req.param("taskId"), patch);
    if (!task) {
      if (store.getTask(c.req.param("taskId"))) {
        return c.json({ error: "task locked (only pending editable)" }, 409);
      }
      return c.json({ error: "task not found" }, 404);
    }
    changed();
    return c.json({ task });
  });

  app.get("/tasks/:taskId/comments", (c) => {
    if (!store.getTask(c.req.param("taskId"))) {
      return c.json({ error: "task not found" }, 404);
    }
    return c.json({ comments: store.listComments(c.req.param("taskId")) });
  });

  app.post("/tasks/:taskId/comments", async (c) => {
    const taskId = c.req.param("taskId");
    let body: { author?: string; kind?: string; content?: string } | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (!store.getTask(taskId)) return c.json({ error: "task not found" }, 404);
    if (!body?.author || !isCommentAuthor(body.author)) {
      return c.json({ error: "author required (user|ai|system)" }, 400);
    }
    if (!body?.kind || !isCommentKind(body.kind)) {
      return c.json({ error: "kind required (note|result)" }, 400);
    }
    const content = body.content?.trim();
    if (!content) return c.json({ error: "content required" }, 400);
    const comment = store.addComment(taskId, {
      author: body.author,
      kind: body.kind,
      content,
    });
    changed();
    return c.json({ comment }, 201);
  });

  app.get("/tasks/:taskId/runs", (c) => {
    if (!store.getTask(c.req.param("taskId"))) {
      return c.json({ error: "task not found" }, 404);
    }
    return c.json({ runs: store.listRuns(c.req.param("taskId")) });
  });

  app.post("/tasks/:taskId/runs", async (c) => {
    const taskId = c.req.param("taskId");
    let body: { status?: string } | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (!store.getTask(taskId)) return c.json({ error: "task not found" }, 404);
    if (!body?.status || !isRunStatus(body.status)) {
      return c.json({ error: "status required (queued|running|finished|canceled)" }, 400);
    }
    const run = store.createRun(taskId, { status: body.status });
    return c.json({ run }, 201);
  });

  app.patch("/runs/:runId", async (c) => {
    let body: { status?: string } | undefined;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    if (!body?.status || !isRunStatus(body.status)) {
      return c.json({ error: "status required (queued|running|finished|canceled)" }, 400);
    }
    const run = store.updateRunStatus(c.req.param("runId"), body.status);
    if (!run) return c.json({ error: "run not found" }, 404);
    return c.json({ run });
  });

  if (scheduler) {
    app.post("/todos/:todoId/planning-session", (c) => {
      const todoId = c.req.param("todoId");
      if (!store.getTodo(todoId)) return c.json({ error: "todo not found" }, 404);
      const result = scheduler.openPlanningSession(todoId);
      if (!result) return c.json({ error: "todo not found" }, 404);
      return c.json(result);
    });

    app.post("/tasks/:taskId/enqueue", (c) => {
      const task = store.getTask(c.req.param("taskId"));
      if (!task) return c.json({ error: "task not found" }, 404);
      // 待执行=开始执行；待审核=继续执行（重新入队）
      if (task.status !== "pending" && task.status !== "review") {
        return c.json({ error: "task locked (only pending/review can enqueue)" }, 409);
      }
      scheduler.enqueue(task.id);
      changed();
      return c.json({ ok: true });
    });

    app.post("/tasks/:taskId/cancel", async (c) => {
      const task = store.getTask(c.req.param("taskId"));
      if (!task) return c.json({ error: "task not found" }, 404);
      if (task.status === "completed" || task.status === "cancelled") {
        return c.json({ error: "task already archived" }, 409);
      }
      await scheduler.cancel(task.id);
      changed();
      return c.json({ ok: true });
    });

    app.post("/tasks/:taskId/approve", async (c) => {
      const task = store.getTask(c.req.param("taskId"));
      if (!task) return c.json({ error: "task not found" }, 404);
      if (task.status !== "review") {
        return c.json({ error: "task locked (only review can approve)" }, 409);
      }
      await scheduler.approve(task.id);
      changed();
      return c.json({ ok: true });
    });
  }

  return app;
}
