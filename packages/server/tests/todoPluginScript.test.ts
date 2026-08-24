import { execFile } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { createHonoApp } from "../src/app.js";
import { createTodoStore, type TodoStore } from "../src/services/todoStore.js";
import type { AppContext } from "../src/services/appContext.js";

const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "plugins",
  "todo",
  "scripts",
  "todo.mjs",
);

function execScript(port: number, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // 关键：剥离环境里的 MUSE_SERVER_URL/MUSE_HOME*（宿主 Muse 应用注入的
    // 生产 server 地址），并显式指向测试 server——否则 todo.mjs 优先读
    // MUSE_SERVER_URL 直连生产环境建 todo（2026-08-24 真实事故）。
    const { MUSE_SERVER_URL: _u, MUSE_HOME: _h, MUSE_HOME_DIR: _hd, ...rest } = process.env;
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { env: { ...rest, MUSE_SERVER_URL: `http://127.0.0.1:${port}`, MUSE_SERVER_PORT: String(port) } },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || String(err)));
        else resolve(stdout);
      },
    );
  });
}

describe("todo plugin script (todo.mjs)", () => {
  let home: string;
  let server: ReturnType<typeof createServer>;
  let port: number;
  let todoStore: TodoStore;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  async function startServer(): Promise<number> {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-plugin-"));
    todoStore = createTodoStore({ home });
    const ctx = {
      home,
      todoStore,
      store: {} as never,
      // 广播桩：createTodoRoutes 变更会调用 broadcastAll（todo:changed）
      hub: { broadcastAll: () => {} } as never,
      runner: {} as never,
      // 简化调度器：只做状态转换（真实调度涉及执行会话/worktree，脚本命令覆盖 API 层即可）
      todoScheduler: {
        enqueue: (taskId: string) => {
          const t = todoStore.getTask(taskId);
          if (t?.status === "review") todoStore.updateTaskStatus(taskId, "pending");
          todoStore.enqueueTask(taskId);
        },
        cancel: async (taskId: string) => {
          todoStore.cancelTask(taskId);
        },
        approve: async (taskId: string) => {
          todoStore.approveTask(taskId);
        },
      } as never,
      registry: {} as never,
    } as AppContext;
    server = createServer(getRequestListener(createHonoApp(ctx).fetch));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    return addr.port;
  }

  it("create → list round-trips through the REST API", async () => {
    port = await startServer();
    const out = await execScript(port, [
      "create",
      "--title",
      "插件测试 todo",
      "--priority",
      "p0",
      "--source",
      "session",
    ]);
    const todo = JSON.parse(out) as { id: string; title: string; priority: string };
    expect(todo.title).toBe("插件测试 todo");
    expect(todo.priority).toBe("p0");

    const list = await execScript(port, ["list"]);
    expect(list).toContain(todo.id);
    expect(list).toContain("插件测试 todo");
  });

  it("add-task creates a task with workdir", async () => {
    port = await startServer();
    const out = await execScript(port, ["create", "--title", "t"]);
    const todo = JSON.parse(out) as { id: string };
    const taskOut = await execScript(port, [
      "add-task",
      todo.id,
      "--title",
      "子任务",
      "--workdir",
      "/tmp/proj",
    ]);
    const task = JSON.parse(taskOut) as { title: string; workdir: string; status: string };
    expect(task.title).toBe("子任务");
    expect(task.workdir).toBe("/tmp/proj");
    expect(task.status).toBe("pending");
  });

  it("add-task 未传 --workdir 时继承 todo 绑定目录（create --workdir 绑定）", async () => {
    port = await startServer();
    const out = await execScript(port, [
      "create",
      "--title",
      "绑目录",
      "--workdir",
      "/tmp/bound",
    ]);
    const todo = JSON.parse(out) as { id: string; workdir: string };
    expect(todo.workdir).toBe("/tmp/bound");
    const taskOut = await execScript(port, ["add-task", todo.id, "--title", "继承目录"]);
    const task = JSON.parse(taskOut) as { workdir: string };
    expect(task.workdir).toBe("/tmp/bound");
  });

  it("add-task --no-worktree 透传 worktreeEnabled=false（git 项目直接在原目录执行）", async () => {
    port = await startServer();
    const out = await execScript(port, ["create", "--title", "t"]);
    const todo = JSON.parse(out) as { id: string };
    const taskOut = await execScript(port, [
      "add-task",
      todo.id,
      "--title",
      "直跑",
      "--workdir",
      "/tmp/proj",
      "--no-worktree",
    ]);
    const task = JSON.parse(taskOut) as { worktreeEnabled?: boolean };
    expect(task.worktreeEnabled).toBe(false);
    // 不带 --no-worktree 时缺省不设字段（隔离）
    const taskOut2 = await execScript(port, [
      "add-task",
      todo.id,
      "--title",
      "隔离",
      "--workdir",
      "/tmp/proj",
    ]);
    const task2 = JSON.parse(taskOut2) as { worktreeEnabled?: boolean };
    expect(task2.worktreeEnabled).toBeUndefined();
  });

  it("task actions: requeue → review → approve / cancel via API", async () => {
    port = await startServer();
    const todo = todoStore.createTodo({ title: "t", source: "session" });
    const task = todoStore.createTask(todo.id, { title: "k", workdir: "/p" });

    // requeue：pending 入队（调度器为 mock 无副作用，命令可执行）
    const requeue = await execScript(port, ["requeue", task.id]);
    expect(requeue).toContain("已重新入队");

    // 置为待审核后 approve（脚本命令走 API）
    todoStore.updateTaskStatus(task.id, "review");
    const approve = await execScript(port, ["approve", task.id]);
    expect(approve).toContain("已审核通过");
    expect(todoStore.getTask(task.id)?.status).toBe("completed");

    // cancel：已完成不可取消（409 → 脚本报错）
    await expect(execScript(port, ["cancel", task.id])).rejects.toThrow();
    // 未归档可取消
    const t2 = todoStore.createTask(todo.id, { title: "k2", workdir: "/p" });
    const cancel = await execScript(port, ["cancel", t2.id]);
    expect(cancel).toContain("已取消");
    expect(todoStore.getTask(t2.id)?.status).toBe("cancelled");
  });
});
