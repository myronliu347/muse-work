import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMuseHomeDir } from "@muse-work/provider";
import { createTodoRoutes } from "../src/routes/todos.js";
import { createTodoStore } from "../src/services/todoStore.js";

function makeApp() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-routes-"));
  const store = createTodoStore({ home });
  const app = createTodoRoutes(store);
  return { app, store, home };
}

describe("todo routes", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it("POST /todos creates with default priority and source", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "修复竞态", description: "**md**", source: "session" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { todo: { priority: string; status: string; source: string } };
    expect(body.todo.priority).toBe("p1");
    expect(body.todo.status).toBe("pending");
    expect(body.todo.source).toBe("session");
  });

  it("POST /todos requires title and source", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /todos accepts and normalizes tags; PATCH /todos/:id replaces tags", async () => {
    const { app } = makeApp();
    const createdRes = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "带标签",
          source: "session",
          tags: [" Urgent ", "urgent", "前端"],
        }),
      }),
    );
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as { todo: { id: string; tags: string[] } };
    expect(created.todo.tags).toEqual(["urgent", "前端"]);

    const patchRes = await app.fetch(
      new Request(`http://x/todos/${created.todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: ["后端", "URGENT", ""] }),
      }),
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { todo: { tags: string[] } };
    expect(patched.todo.tags).toEqual(["后端", "urgent"]);
  });

  it("GET /todos lists sorted", async () => {
    const { app } = makeApp();
    await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "a", priority: "p2", source: "session" }),
      }),
    );
    await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "b", priority: "p0", source: "manual" }),
      }),
    );
    const res = await app.fetch(new Request("http://x/todos"));
    const body = (await res.json()) as { todos: Array<{ title: string }> };
    expect(body.todos.map((t) => t.title)).toEqual(["b", "a"]);
  });

  it("PATCH /todos/:id edits in 待执行, locked otherwise", async () => {
    const { app } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t2", priority: "p0" }),
      }),
    );
    const body = (await res.json()) as { todo: { title: string; priority: string } };
    expect(body.todo.title).toBe("t2");
    expect(body.todo.priority).toBe("p0");
  });

  it("POST /todos/:id/tasks requires workdir and moves todo to 进行中", async () => {
    const { app } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };

    // workdir 必填
    const missing = await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task1" }),
      }),
    );
    expect(missing.status).toBe(400);

    const ok = await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task1", workdir: "/tmp/proj" }),
      }),
    );
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { task: { status: string; workdir: string } };
    expect(body.task.status).toBe("pending");
    expect(body.task.workdir).toBe("/tmp/proj");

    const todoRes = await app.fetch(new Request(`http://x/todos/${todo.id}`));
    const todoBody = (await todoRes.json()) as { todo: { status: string } };
    expect(todoBody.todo.status).toBe("in_progress");
  });

  it("POST /todos accepts optional workdir (trim; empty stays unbound)", async () => {
    const { app } = makeApp();
    const withWd = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "绑目录", source: "session", workdir: "  /tmp/proj  " }),
      }),
    );
    expect(withWd.status).toBe(201);
    const bound = (await withWd.json()) as { todo: { workdir?: string } };
    expect(bound.todo.workdir).toBe("/tmp/proj");

    const emptyWd = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "不绑", source: "session", workdir: "   " }),
      }),
    );
    expect(emptyWd.status).toBe(201);
    const unbound = (await emptyWd.json()) as { todo: { workdir?: string } };
    expect(unbound.todo.workdir).toBeUndefined();
  });

  it("POST /todos/:id/tasks 未传 workdir 时继承 todo 绑定目录；todo 无绑定仍 400", async () => {
    const { app } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session", workdir: "/tmp/bound" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };

    // 未传 workdir → 继承 todo.workdir
    const inherited = await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task1" }),
      }),
    );
    expect(inherited.status).toBe(201);
    const body = (await inherited.json()) as { task: { workdir: string } };
    expect(body.task.workdir).toBe("/tmp/bound");

    // 未绑定 workdir 的 todo：未传仍 400
    const created2 = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t2", source: "session" }),
      }),
    );
    const { todo: todo2 } = (await created2.json()) as { todo: { id: string } };
    const missing = await app.fetch(
      new Request(`http://x/todos/${todo2.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task1" }),
      }),
    );
    expect(missing.status).toBe(400);
  });

  it("POST /todos/:id/tasks 支持 baseBranch（worktree base 分支）", async () => {
    const { app } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task1", workdir: "/tmp/proj", baseBranch: "develop" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { task: { baseBranch?: string } };
    expect(body.task.baseBranch).toBe("develop");
  });

  it("POST /todos/:id/tasks 支持 worktreeEnabled=false（git 项目也直接在原目录执行）", async () => {
    const { app } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task1", workdir: "/tmp/proj", worktreeEnabled: false }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { task: { worktreeEnabled?: boolean } };
    expect(body.task.worktreeEnabled).toBe(false);
    // 缺省（未传）不设字段 → 调度器按隔离处理
    const res2 = await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "task2", workdir: "/tmp/proj" }),
      }),
    );
    const body2 = (await res2.json()) as { task: { worktreeEnabled?: boolean } };
    expect(body2.task.worktreeEnabled).toBeUndefined();
  });

  it("POST /todos/:id/cancel marks cancelled and cascades to open tasks", async () => {
    const { app, store, home } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    const task = store.createTask(todo.id, { title: "k", workdir: "/tmp/p" });

    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}/cancel`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(store.getTodo(todo.id)?.status).toBe("cancelled");
    // 归档后 task 明细从内存卸载，级联取消状态从磁盘读回
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    const saved = JSON.parse(
      fs.readFileSync(
        path.join(getMuseHomeDir(home), "db", "todos", todo.id, "tasks.json"),
        "utf-8",
      ),
    ) as { tasks: Array<{ status: string }> };
    expect(saved.tasks[0].status).toBe("cancelled");
    // cancelled todo 从 list 消失（已被服务端过滤）
    const listRes = await app.fetch(new Request("http://x/todos"));
    const list = (await listRes.json()) as { todos: unknown[] };
    expect(list.todos).toEqual([]);
  });

  it("GET /todos?archived=1 返回已完成 todo（不含已取消）", async () => {
    const { app, store } = makeApp();
    const active = store.createTodo({ title: "进行中", source: "session" });
    const doneTodo = store.createTodo({ title: "已完成", source: "session" });
    const cancelledTodo = store.createTodo({ title: "已取消", source: "session" });
    store.updateTaskStatus(
      store.createTask(doneTodo.id, { title: "k", workdir: "/p" }).id,
      "completed",
    );
    store.completeTodo(doneTodo.id);
    store.cancelTodo(cancelledTodo.id);

    // 默认不含归档
    const res = await app.fetch(new Request("http://x/todos"));
    const body = (await res.json()) as { todos: Array<{ id: string }> };
    expect(body.todos.map((t) => t.id)).toEqual([active.id]);

    // archived=1 只看已完成
    const archRes = await app.fetch(new Request("http://x/todos?archived=1"));
    const arch = (await archRes.json()) as { todos: Array<{ id: string; status: string }> };
    expect(arch.todos.map((t) => t.id)).toEqual([doneTodo.id]);
    expect(arch.todos[0].status).toBe("completed");
  });

  it("GET /todos/:id/tasks 对已完成 todo 从磁盘读回明细", async () => {
    const { app, store } = makeApp();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/tmp/p" });
    store.addComment(task.id, { author: "user", kind: "note", content: "评论" });
    store.updateTaskStatus(task.id, "completed");
    store.completeTodo(todo.id);

    const tasksRes = await app.fetch(new Request(`http://x/todos/${todo.id}/tasks`));
    const tasks = (await tasksRes.json()) as { tasks: Array<{ id: string; status: string }> };
    expect(tasks.tasks.length).toBe(1);
    expect(tasks.tasks[0].status).toBe("completed");
    const commentsRes = await app.fetch(new Request(`http://x/tasks/${task.id}/comments`));
    const comments = (await commentsRes.json()) as { comments: Array<{ content: string }> };
    expect(comments.comments[0].content).toBe("评论");
  });

  it("POST /todos/:id/cancel returns 404 for missing todo", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/todos/nope/cancel", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /todos/:id/complete marks completed when no open tasks", async () => {
    const { app, store } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    // 无 task → 允许直接完成
    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}/complete`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(store.getTodo(todo.id)?.status).toBe("completed");
  });

  it("POST /todos/:id/complete 409 when tasks are pending/running/review", async () => {
    const { app, store } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    store.createTask(todo.id, { title: "k", workdir: "/tmp/p" }); // pending
    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}/complete`, { method: "POST" }),
    );
    expect(res.status).toBe(409);
    expect(store.getTodo(todo.id)?.status).not.toBe("completed");
    // 全部到终态（completed/cancelled）后允许完成
    store.updateTaskStatus(store.listTasks(todo.id)[0].id, "completed");
    const ok = await app.fetch(
      new Request(`http://x/todos/${todo.id}/complete`, { method: "POST" }),
    );
    expect(ok.status).toBe(200);
    expect(store.getTodo(todo.id)?.status).toBe("completed");
  });

  it("POST /todos/:id/complete returns 404 for missing todo", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://x/todos/nope/complete", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for missing todo", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("http://x/todos/nope"));
    expect(res.status).toBe(404);
  });
});

describe("todo routes broadcast todo:changed", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it("mutation endpoints broadcast todo:changed (对话内 AI 跑 todo.mjs 时 webview 靠它刷新)", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-bcast-"));
    const store = createTodoStore({ home });
    const events: unknown[] = [];
    const hub = {
      broadcastAll: (e: unknown) => events.push(e),
    } as unknown as NonNullable<Parameters<typeof createTodoRoutes>[2]>;
    const app = createTodoRoutes(store, undefined, hub);

    const post = (url: string, body?: unknown) =>
      app.fetch(
        new Request(`http://x${url}`, {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        }),
      );

    // 创建 todo → 广播
    const created = await post("/todos", { title: "t", source: "session" });
    const { todo } = (await created.json()) as { todo: { id: string } };
    // PATCH 编辑（todo 仍 pending 可编辑）→ 广播
    const patched = await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t2" }),
      }),
    );
    expect(patched.status).toBe(200);
    // 加 task（todo → in_progress）→ 广播
    await post(`/todos/${todo.id}/tasks`, {
      title: "k",
      workdir: "/tmp/p",
      description: "**md**",
    });
    const { tasks } = (await (
      await app.fetch(new Request(`http://x/todos/${todo.id}/tasks`))
    ).json()) as { tasks: Array<{ id: string }> };
    // 评论 → 广播
    await post(`/tasks/${tasks[0].id}/comments`, {
      author: "user",
      kind: "note",
      content: "hi",
    });

    const changed = events.filter((e) => (e as { type?: string }).type === "todo:changed");
    expect(changed.length).toBe(4); // create + patch + add-task + comment
  });
});

describe("todo routes PATCH workdir", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  it("PATCH /todos/:id 绑定/修改/解绑 workdir（trim；空串解绑）", async () => {
    const { app } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };

    // 绑定（trim）
    const bound = await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "  /tmp/proj  " }),
      }),
    );
    expect(bound.status).toBe(200);
    expect(((await bound.json()) as { todo: { workdir?: string } }).todo.workdir).toBe("/tmp/proj");

    // 修改
    const updated = await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "/tmp/other" }),
      }),
    );
    expect(((await updated.json()) as { todo: { workdir?: string } }).todo.workdir).toBe("/tmp/other");

    // 空串/纯空白 → 解绑
    const unbound = await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "   " }),
      }),
    );
    expect(unbound.status).toBe(200);
    const body = (await unbound.json()) as { todo: { workdir?: string } };
    expect(body.todo.workdir).toBeUndefined();
  });

  it("PATCH workdir 非 pending → 409（其余字段也不改）", async () => {
    const { app, store } = makeApp();
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    // 建 task → todo 转 in_progress（锁定）
    await app.fetch(
      new Request(`http://x/todos/${todo.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "k", workdir: "/p" }),
      }),
    );
    const res = await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "/tmp/x" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(store.getTodo(todo.id)?.workdir).toBeUndefined();
  });

  it("PATCH workdir 变更 → 调 scheduler.syncPlanningWorkdir", async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-wd-sync-"));
    const store = createTodoStore({ home });
    const syncPlanningWorkdir = vi.fn();
    const scheduler = { syncPlanningWorkdir } as unknown as NonNullable<
      Parameters<typeof createTodoRoutes>[1]
    >;
    const app = createTodoRoutes(store, scheduler);
    const created = await app.fetch(
      new Request("http://x/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t", source: "session" }),
      }),
    );
    const { todo } = (await created.json()) as { todo: { id: string } };
    // 无 workdir 变更（仅标题）→ 不调
    await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "t2" }),
      }),
    );
    expect(syncPlanningWorkdir).not.toHaveBeenCalled();
    // 带 workdir 变更 → 调
    await app.fetch(
      new Request(`http://x/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workdir: "/tmp/proj" }),
      }),
    );
    expect(syncPlanningWorkdir).toHaveBeenCalledWith(todo.id);
  });
});
