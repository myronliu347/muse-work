import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTodoStore } from "../src/services/todoStore.js";

describe("todoStore", () => {
  let home: string;
  afterEach(() => {
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  function makeStore() {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-"));
    return createTodoStore({ home });
  }

  it("creates todo with default priority p1 and persists", () => {
    const store = makeStore();
    const todo = store.createTodo({
      title: "修复竞态",
      description: "**markdown** 描述",
      source: "session",
    });
    expect(todo.priority).toBe("p1");
    expect(todo.status).toBe("pending");
    expect(todo.source).toBe("session");
    expect(todo.description).toBe("**markdown** 描述");

    const reloaded = createTodoStore({ home });
    expect(reloaded.getTodo(todo.id)?.title).toBe("修复竞态");
    expect(reloaded.getTodo(todo.id)?.priority).toBe("p1");
  });

  it("creates todo with explicit priority p0", () => {
    const store = makeStore();
    const todo = store.createTodo({
      title: "紧急",
      priority: "p0",
      source: "manual",
    });
    expect(todo.priority).toBe("p0");
  });

  it("lists todos sorted by priority then createdAt", () => {
    const store = makeStore();
    const p2 = store.createTodo({ title: "a", priority: "p2", source: "session" });
    const p0 = store.createTodo({ title: "b", priority: "p0", source: "session" });
    const p1 = store.createTodo({ title: "c", priority: "p1", source: "session" });
    expect(store.listTodos().map((t) => t.id)).toEqual([p0.id, p1.id, p2.id]);
  });

  it("edits todo title/description/priority only in 待执行", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const edited = store.updateTodo(todo.id, {
      title: "t2",
      description: "d2",
      priority: "p0",
    });
    expect(edited?.title).toBe("t2");
    expect(edited?.priority).toBe("p0");

    // 非待执行锁定
    const running = store.updateTodoStatus(todo.id, "in_progress");
    expect(running?.status).toBe("in_progress");
    const blocked = store.updateTodo(todo.id, { title: "t3" });
    expect(blocked).toBeUndefined();
    expect(store.getTodo(todo.id)?.title).toBe("t2");
  });

  it("does not allow editing source", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    // @ts-expect-error source is not editable via updateTodo
    const edited = store.updateTodo(todo.id, { source: "popo" });
    expect(edited?.source).toBe("session");
  });

  it("normalizes and persists tags on create/update", () => {
    const store = makeStore();
    const todo = store.createTodo({
      title: "t",
      source: "session",
      tags: [" Urgent ", "urgent", "前端", "前端", ""],
    });
    // trim + 去空 + 小写 + 去重（保序）
    expect(todo.tags).toEqual(["urgent", "前端"]);

    const updated = store.updateTodo(todo.id, { tags: ["后端", "URGENT"] });
    expect(updated?.tags).toEqual(["后端", "urgent"]);

    const reloaded = createTodoStore({ home });
    expect(reloaded.getTodo(todo.id)?.tags).toEqual(["后端", "urgent"]);
  });

  it("createTodo without tags defaults to []", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    expect(todo.tags).toEqual([]);
  });

  it("creates todo with bound workdir and persists", () => {
    const store = makeStore();
    const todo = store.createTodo({
      title: "t",
      source: "session",
      workdir: "/Users/demo/repo",
    });
    expect(todo.workdir).toBe("/Users/demo/repo");

    const reloaded = createTodoStore({ home });
    expect(reloaded.getTodo(todo.id)?.workdir).toBe("/Users/demo/repo");
  });

  it("createTodo without workdir leaves it undefined", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    expect(todo.workdir).toBeUndefined();
  });

  it("cancels todo (status 已取消) and cascades to tasks later (T6)", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const cancelled = store.cancelTodo(todo.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(store.listTodos()).toHaveLength(0); // 归档不显示
  });

  it("completeTodo only when no task is pending/running/review", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    // 无 task → 可直接完成
    expect(store.completeTodo(todo.id)?.status).toBe("completed");

    const todo2 = store.createTodo({ title: "t2", source: "session" });
    const task = store.createTask(todo2.id, { title: "k", workdir: "/p" }); // pending
    expect(store.completeTodo(todo2.id)).toBeUndefined();
    // 终态 task 不阻塞；全终态后可完成
    store.updateTaskStatus(task.id, "completed");
    expect(store.completeTodo(todo2.id)?.status).toBe("completed");

    // 不存在 → undefined
    expect(store.completeTodo("nope")).toBeUndefined();
  });

  it("completeTodo rejects already-cancelled todo", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    store.cancelTodo(todo.id);
    expect(store.getTodo(todo.id)?.status).toBe("cancelled");
    expect(store.completeTodo(todo.id)).toBeUndefined();
    expect(store.getTodo(todo.id)?.status).toBe("cancelled");
  });

  it("creates task requiring workdir and moves todo to 进行中", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, {
      title: "task1",
      description: "md",
      workdir: "/tmp/proj",
    });
    expect(task.workdir).toBe("/tmp/proj");
    expect(task.status).toBe("pending");
    expect(store.getTodo(todo.id)?.status).toBe("in_progress");
    expect(store.listTasks(todo.id).map((t) => t.id)).toEqual([task.id]);
  });

  it("createTask 支持 baseBranch（worktree 的 base 分支）", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, {
      title: "task1",
      workdir: "/tmp/proj",
      baseBranch: "develop",
    });
    expect(task.baseBranch).toBe("develop");
    expect(store.getTask(task.id)?.baseBranch).toBe("develop");
    // 未指定 → 无 baseBranch（执行时自动推断默认分支）
    const plain = store.createTask(todo.id, { title: "t2", workdir: "/tmp/p2" });
    expect(plain.baseBranch).toBeUndefined();
  });

  it("edits task title/description only in 待执行, workdir immutable", () => {
    const store = makeStore();
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, {
      title: "t1",
      workdir: "/tmp/proj",
    });
    const edited = store.updateTask(task.id, { title: "t2", description: "d" });
    expect(edited?.title).toBe("t2");
    // workdir 不可改
    const wd = store.updateTask(task.id, { workdir: "/tmp/other" });
    expect(wd?.workdir).toBe("/tmp/proj");
    // 非待执行锁定
    store.updateTaskStatus(task.id, "running");
    expect(store.updateTask(task.id, { title: "t3" })).toBeUndefined();
    expect(store.getTask(task.id)?.title).toBe("t2");
  });

  it("returns undefined for missing entities", () => {
    const store = makeStore();
    expect(store.getTodo("nope")).toBeUndefined();
    expect(store.getTask("nope")).toBeUndefined();
    expect(store.updateTodo("nope", { title: "x" })).toBeUndefined();
  });
});
