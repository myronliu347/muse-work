import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTodoRoutes } from "../src/routes/todos.js";
import { createTodoStore } from "../src/services/todoStore.js";
import type { TodoScheduler } from "../src/services/todoScheduler.js";

function makeApp() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-cmt-"));
  const store = createTodoStore({ home });
  const app = createTodoRoutes(store);
  return { app, store, home };
}

describe("todoStore comments & runs", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  function makeStore() {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-cmt-"));
    return createTodoStore({ home });
  }

  it("adds comments to a task with author and kind", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    const c = store.addComment(task.id, { author: "ai", kind: "result", content: "**done**" });
    expect(c.author).toBe("ai");
    expect(c.kind).toBe("result");
    expect(c.content).toBe("**done**");
    const list = store.listComments(task.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(c.id);
  });

  it("persists comments across reload", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    store.addComment(task.id, { author: "user", kind: "note", content: "再审一次" });
    const reloaded = createTodoStore({ home });
    expect(reloaded.listComments(task.id)[0]?.content).toBe("再审一次");
  });

  it("creates run records with status and timestamps", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    const run = store.createRun(task.id, { status: "queued" });
    expect(run.status).toBe("queued");
    expect(run.startedAt).toBeUndefined();
    expect(store.listRuns(task.id)).toHaveLength(1);
    const started = store.updateRunStatus(run.id, "running");
    expect(started?.status).toBe("running");
    expect(started?.startedAt).toBeTypeOf("number");
  });
});

describe("todo comment/run routes", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  async function makeTask() {
    const { app, store, home: h } = makeApp();
    home = h;
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    return { app, store, task };
  }

  it("POST/GET /tasks/:id/comments round-trips", async () => {
    const { app, task } = await makeTask();
    const post = await app.fetch(
      new Request(`http://x/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "user", kind: "note", content: "看一下" }),
      }),
    );
    expect(post.status).toBe(201);
    const list = await app.fetch(new Request(`http://x/tasks/${task.id}/comments`));
    const body = (await list.json()) as { comments: Array<{ content: string }> };
    expect(body.comments[0].content).toBe("看一下");
  });

  it("rejects invalid comment author and missing task", async () => {
    const { app, task } = await makeTask();
    const bad = await app.fetch(
      new Request(`http://x/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "robot", kind: "note", content: "x" }),
      }),
    );
    expect(bad.status).toBe(400);
    const missing = await app.fetch(
      new Request("http://x/tasks/nope/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "user", kind: "note", content: "x" }),
      }),
    );
    expect(missing.status).toBe(404);
  });

  it("POST /tasks/:id/runs and PATCH /runs/:id", async () => {
    const { app, task } = await makeTask();
    const post = await app.fetch(
      new Request(`http://x/tasks/${task.id}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "queued" }),
      }),
    );
    expect(post.status).toBe(201);
    const run = (await post.json()) as { run: { id: string; status: string } };
    const patch = await app.fetch(
      new Request(`http://x/runs/${run.run.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "running" }),
      }),
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { run: { status: string; startedAt?: number } };
    expect(body.run.status).toBe("running");
    expect(body.run.startedAt).toBeTypeOf("number");
  });
});

describe("todo execution routes (enqueue/cancel)", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  function makeAppWithScheduler() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-execroute-"));
    const store = createTodoStore({ home });
    const scheduler = {
      enqueue: vi.fn(),
      cancel: vi.fn(async () => {}),
    } as unknown as TodoScheduler;
    const app = createTodoRoutes(store, scheduler);
    return { app, store, scheduler, home };
  }

  it("POST /tasks/:id/enqueue calls scheduler for 待执行; 409 for others", async () => {
    const { app, store, scheduler } = makeAppWithScheduler();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    const ok = await app.fetch(
      new Request(`http://x/tasks/${task.id}/enqueue`, { method: "POST" }),
    );
    expect(ok.status).toBe(200);
    expect(scheduler.enqueue).toHaveBeenCalledWith(task.id);
    // 已取消不可入队
    store.updateTaskStatus(task.id, "cancelled");
    const locked = await app.fetch(
      new Request(`http://x/tasks/${task.id}/enqueue`, { method: "POST" }),
    );
    expect(locked.status).toBe(409);
  });

  it("POST /tasks/:taskId/cancel calls scheduler.cancel", async () => {
    const { app, store, scheduler } = makeAppWithScheduler();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    const res = await app.fetch(
      new Request(`http://x/tasks/${task.id}/cancel`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(scheduler.cancel).toHaveBeenCalledWith(task.id);
    // 不存在 404
    const missing = await app.fetch(
      new Request("http://x/tasks/nope/cancel", { method: "POST" }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("todoStore execution flow", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  function makeStore() {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-exec-"));
    return createTodoStore({ home });
  }

  it("enqueueTask creates a queued run; idempotent while active", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    const run = store.enqueueTask(task.id);
    expect(run?.status).toBe("queued");
    // 已有活跃 run 不再重复入队
    expect(store.enqueueTask(task.id)).toBeUndefined();
    // 非待执行不可入队
    store.updateTaskStatus(task.id, "completed");
    expect(store.enqueueTask(task.id)).toBeUndefined();
  });

  it("markRunning transitions task to 执行中 with executionSessionId", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    store.enqueueTask(task.id);
    const started = store.markRunning(task.id, "sess-1");
    expect(started?.status).toBe("running");
    expect(started?.executionSessionId).toBe("sess-1");
    const runs = store.listRuns(task.id);
    expect(runs[0].status).toBe("running");
    expect(runs[0].startedAt).toBeTypeOf("number");
  });

  it("completeRun moves task to 待审核, adds result comment, run finished", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    store.enqueueTask(task.id);
    store.markRunning(task.id, "sess-1");
    const done = store.completeRun(task.id, { ok: true });
    expect(done?.status).toBe("review");
    expect(store.listRuns(task.id)[0].status).toBe("finished");
    const comments = store.listComments(task.id);
    expect(comments[0].author).toBe("system");
    expect(comments[0].kind).toBe("result");
  });

  it("completeRun with error notes the failure; todo 不再因 task 全完成自动完成（手动 completeTodo）", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const t1 = store.createTask(todo.id, { title: "a", workdir: "/p" });
    const t2 = store.createTask(todo.id, { title: "b", workdir: "/p" });
    store.enqueueTask(t1.id);
    store.markRunning(t1.id, "s1");
    store.completeRun(t1.id, { ok: false, error: "API 超时" });
    expect(store.listComments(t1.id)[0].content).toContain("API 超时");
    // 还有 t2 未完成 → todo 仍是进行中
    expect(store.getTodo(todo.id)?.status).toBe("in_progress");
    // 全部完成 → 不再自动完成（旧 checkTodoCompleted 已移除）
    store.updateTaskStatus(t1.id, "completed");
    store.updateTaskStatus(t2.id, "completed");
    expect(store.getTodo(todo.id)?.status).toBe("in_progress");
    // 手动标记完成 → 已完成
    expect(store.completeTodo(todo.id)?.status).toBe("completed");
  });

  it("cancelTask cancels active run and marks task 已取消", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    store.enqueueTask(task.id);
    store.markRunning(task.id, "sess-1");
    const canceled = store.cancelTask(task.id);
    expect(canceled?.status).toBe("cancelled");
    expect(store.listRuns(task.id)[0].status).toBe("canceled");
    // 已完成不可取消
    store.updateTaskStatus(task.id, "completed");
    expect(store.cancelTask(task.id)).toBeUndefined();
  });

  it("getTaskByExecutionSession finds task; completeRun skips non-执行中", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    store.enqueueTask(task.id);
    store.markRunning(task.id, "sess-x");
    expect(store.getTaskByExecutionSession("sess-x")?.id).toBe(task.id);
    // 已取消后 completeRun 不再生效（防 abort 回调误处理）
    store.cancelTask(task.id);
    expect(store.completeRun(task.id, { ok: true })).toBeUndefined();
  });
});
