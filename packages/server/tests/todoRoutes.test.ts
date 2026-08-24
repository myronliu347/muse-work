import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    // 归档后 task 明细从内存卸载（级联取消状态已落盘）
    expect(store.getTask(task.id)).toBeUndefined();
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
