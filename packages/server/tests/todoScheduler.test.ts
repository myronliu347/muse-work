import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTodoStore } from "../src/services/todoStore.js";
import { createTodoScheduler } from "../src/services/todoScheduler.js";
import {
  isSystemInjectContent,
  wrapSystemInject,
} from "../src/services/sessionRunner/index.js";
import type { SessionRunner } from "../src/services/sessionRunner/index.js";
import type { SessionStore } from "../src/services/sessionStore.js";
import type { WsHub } from "../src/services/wsHub.js";

describe("system-inject marker", () => {
  it("wraps content and round-trips detection", () => {
    const wrapped = wrapSystemInject("进度：task 完成");
    expect(isSystemInjectContent(wrapped)).toBe(true);
    expect(isSystemInjectContent("普通消息")).toBe(false);
    expect(wrapped).toContain("进度：task 完成");
  });
});

function makeScheduler(opts: {
  tickMs?: number;
  maxConcurrent?: number;
  runner?: Partial<SessionRunner>;
  sessionStore?: Partial<SessionStore>;
  hub?: Partial<WsHub>;
}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-sched-"));
  const store = createTodoStore({ home });
  const sessions = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const sessionStore: Partial<SessionStore> = {
    create: vi.fn((input) => {
      const s = { id: `sess-${++counter}`, waveSessionId: `wave-${counter}`, ...input };
      sessions.set(s.id as string, s);
      return s as never;
    }),
    get: (id) => sessions.get(id) as never,
    delete: vi.fn((id) => {
      const s = sessions.get(id);
      sessions.delete(id);
      return s as never;
    }),
    ...opts.sessionStore,
  };
  const runner: Partial<SessionRunner> = {
    sendMessage: vi.fn(async () => ({ accepted: true })),
    abortMessage: vi.fn(async () => ({ ok: true })),
    setOnTurnSettled: vi.fn(),
    getMessages: vi.fn(async () => []),
    disposeSession: vi.fn(async () => {}),
    ...opts.runner,
  };
  const registry = {
    getActive: () => ({ providerId: "codemaker", modelId: "m1" }),
  } as never;
  const hub: Partial<WsHub> = {
    broadcastAll: vi.fn(),
    ...opts.hub,
  };
  const scheduler = createTodoScheduler({
    store,
    runner: runner as SessionRunner,
    sessionStore: sessionStore as SessionStore,
    registry,
    hub: hub as WsHub,
    home,
    tickMs: opts.tickMs ?? 60_000,
    maxConcurrent: opts.maxConcurrent ?? 3,
  });
  return { store, scheduler, runner, sessionStore, hub, home };
}

describe("todoScheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("创建即入队：槽位空时立即执行（task 执行中 + run running + 执行会话 bypass）", async () => {
    const { store, scheduler, runner, sessionStore } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const runs = store.listRuns(task.id);
    expect(runs[0].status).toBe("running");
    expect(runs[0].startedAt).toBeTypeOf("number");
    expect(runner.sendMessage).toHaveBeenCalledTimes(1);
    const [sessionId] = (runner.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sessionId).toBe(store.getTask(task.id)?.executionSessionId);
    expect(sessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "bypassPermissions", workdir: "/p" }),
    );
    scheduler.stop();
  });

  it("并发 3：第 4 个 task 排队不执行，排队中仍待执行", async () => {
    const { store, scheduler, runner } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const tasks = [1, 2, 3, 4].map((n) =>
      store.createTask(todo.id, { title: `k${n}`, workdir: `/p${n}` }),
    );
    scheduler.start();
    await vi.waitFor(() => {
      const running = tasks.filter((t) => store.getTask(t.id)?.status === "running").length;
      expect(running).toBe(3);
    });
    expect(store.getTask(tasks[3].id)?.status).toBe("pending");
    expect(store.listRuns(tasks[3].id)[0].status).toBe("queued");
    expect(runner.sendMessage).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it("槽位释放后 FIFO 按序启动", async () => {
    const { store, scheduler } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const tasks = [1, 2, 3, 4].map((n) =>
      store.createTask(todo.id, { title: `k${n}`, workdir: `/p${n}` }),
    );
    scheduler.start();
    await vi.waitFor(() => {
      expect(tasks.filter((t) => store.getTask(t.id)?.status === "running").length).toBe(3);
    });
    // 第 1 个执行结束 → 待审核 → 槽位释放 → 第 4 个启动
    const execId = store.getTask(tasks[0].id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => expect(store.getTask(tasks[0].id)?.status).toBe("review"));
    await vi.waitFor(() => expect(store.getTask(tasks[3].id)?.status).toBe("running"));
    scheduler.stop();
  });

  it("执行结束（含报错）→ 待审核 + system result 评论", async () => {
    const { store, scheduler } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    // 成功路径
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    expect(store.listRuns(task.id)[0].status).toBe("finished");
    expect(store.listComments(task.id)[0]?.content).toContain("执行完成");
    // 报错路径：再入队执行一次，这次失败
    store.updateTaskStatus(task.id, "pending");
    scheduler.enqueue(task.id);
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId2 = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId2, { ok: false, error: "API 超时" });
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    const comments = store.listComments(task.id);
    expect(comments[comments.length - 1]?.content).toContain("API 超时");
    scheduler.stop();
  });

  it("取消执行中 task：中止会话 + 已取消 + run canceled（worktree 已建则删）", async () => {
    const { store, scheduler, runner } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    await scheduler.cancel(task.id);
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(store.listRuns(task.id)[0].status).toBe("canceled");
    expect(runner.abortMessage).toHaveBeenCalledWith(execId);
    // 已取消后 turn 结束回调被忽略（不转待审核）
    scheduler.handleTurnSettled(execId, { ok: false, error: "Aborted" });
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    scheduler.stop();
  });

  it("重启恢复：running 中断回待执行 + queued 自动恢复调度", async () => {
    const { store, scheduler, runner } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const t1 = store.createTask(todo.id, { title: "a", workdir: "/pa" });
    const t2 = store.createTask(todo.id, { title: "b", workdir: "/pb" });
    // 模拟上次进程崩溃时的落盘状态：t1 执行中 + running run；t2 待执行 + queued run
    const r1 = store.enqueueTask(t1.id)!;
    store.updateRunStatus(r1.id, "running");
    store.updateTaskStatus(t1.id, "running");
    store.updateTaskStatus(t1.id, "running"); // idempotent no-op, keeps 执行中
    // 重新设置 executionSessionId 模拟已建会话（t1）
    // 没有公开 setter，直接用 cancelTask 走不通；这里通过 markRunning 走一遍入队即可
    const r2 = store.enqueueTask(t2.id)!;
    expect(r2.status).toBe("queued");
    void r1;
    void r2;

    // 新建调度器（模拟重启）→ start 时 recoverInterrupted
    const sched2 = createTodoScheduler({
      store,
      runner: runner as SessionRunner,
      sessionStore: {
        create: (input) => ({ id: "sess-new", ...input }),
        get: () => undefined,
      } as never,
      registry: { getActive: () => ({ providerId: "codemaker", modelId: "m1" }) } as never,
      home: "",
      tickMs: 60_000,
    });
    // t1 的 running run 在恢复时被标中断（回待执行）；但 t1 无 executionSessionId 无法被 getTaskByExecutionSession 找到 → 直接标
    sched2.start();
    await vi.waitFor(() => {
      // t1 的 running run 已 interrupted（恢复）
      const t1runs = store.listRuns(t1.id);
      expect(t1runs[t1runs.length - 1].status).toBe("interrupted");
    });
    // t1 中断回待执行但不在队列（最近 run interrupted → 跳过自动入队）
    expect(store.getTask(t1.id)?.status).toBe("pending");
    expect(store.listRuns(t1.id).filter((r) => r.status === "queued").length).toBe(0);
    // t2（queued）继续调度执行
    await vi.waitFor(() => expect(store.getTask(t2.id)?.status).toBe("running"));
    sched2.stop();
    scheduler.stop();
  });

  it("git workdir 自动建 worktree，执行会话 workdir 指向 worktree", async () => {
    // 真实 git 仓库 fixture
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-repo-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    const { store, scheduler, sessionStore } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: repo });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const task2 = store.getTask(task.id)!;
    expect(task2.worktreeName).toBe(task.id);
    expect(task2.worktreeRepoRoot).toBe(fs.realpathSync(repo));
    expect(fs.existsSync(path.join(repo, ".wave", "worktrees", task.id))).toBe(true);
    const created = sessionStore.create as ReturnType<typeof vi.fn>;
    const lastCall = created.mock.calls[created.mock.calls.length - 1][0] as {
      workdir: string;
      title?: string;
    };
    expect(lastCall.workdir).toContain(".wave/worktrees/");
    // 执行会话标题 = task 标题（侧栏一眼认出）
    expect(lastCall.title).toBe("k");
    scheduler.stop();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("git workdir + worktreeEnabled=false：不建 worktree，直接在原目录执行", async () => {
    // 真实 git 仓库 fixture
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-repo-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    const { store, scheduler, sessionStore, runner } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, {
      title: "k",
      workdir: repo,
      worktreeEnabled: false,
    });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const task2 = store.getTask(task.id)!;
    // 无 worktree 字段、未建 worktree 目录
    expect(task2.worktreeName).toBeUndefined();
    expect(fs.existsSync(path.join(repo, ".wave", "worktrees", task.id))).toBe(false);
    // 执行会话 workdir = 原目录
    const created = sessionStore.create as ReturnType<typeof vi.fn>;
    const lastCall = created.mock.calls[created.mock.calls.length - 1][0] as {
      workdir: string;
      worktreeName?: string;
    };
    expect(lastCall.workdir).toBe(repo);
    expect(lastCall.worktreeName).toBeUndefined();
    // 执行 prompt 指向原目录
    const sendCall = (runner.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendCall[1]).toContain(repo);
    scheduler.stop();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("enqueue 对待审核 task 生效（继续执行：回待执行再入队）", async () => {
    const { store, scheduler, runner } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    store.updateTaskStatus(task.id, "review");
    scheduler.enqueue(task.id);
    // 待审核 → 回待执行入队 → 立即调度执行
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    expect(store.listRuns(task.id).length).toBe(1);
    expect(runner.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("task 进待审核 → 旁路 askBtw 复核（不注入规划会话）→ AI 结论写 note 评论", async () => {
    const { store, scheduler, runner } = makeScheduler({
      runner: {
        askBtw: vi.fn(async () => "改动合理，测试覆盖完整，建议通过。"),
      },
    });
    const todo = store.createTodo({ title: "t", source: "session" });
    store.setPlanningSessionId(todo.id, "plan-1");
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    // 执行结束 → 待审核 + 旁路复核（不向规划会话注入消息）
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    const askCalls = (runner.askBtw as ReturnType<typeof vi.fn>).mock.calls;
    expect(askCalls.length).toBe(1);
    expect(askCalls[0][0]).toBe("plan-1"); // 目标=规划会话 agent
    expect(askCalls[0][1]).toContain("AI 复核");
    // 结论直接写 note 评论（无需等复核 turn 结束）
    await vi.waitFor(() => {
      const notes = store.listComments(task.id).filter((c) => c.kind === "note" && c.author === "ai");
      expect(notes.length).toBe(1);
      expect(notes[0].content).toContain("改动合理");
    });
    // 规划会话未收到任何消息（不污染对话）
    expect((runner.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "plan-1").length).toBe(0);
    scheduler.stop();
  });

  it("执行完成评论 = 执行会话最后 assistant 消息的最后一个文本块（author ai）；无文本回退固定文案", async () => {
    const { store, scheduler } = makeScheduler({
      runner: {
        getMessages: vi.fn(async () => [
          { role: "assistant", blocks: [{ type: "text", content: "旧消息总结" }] },
          {
            role: "assistant",
            blocks: [
              { type: "reasoning", content: "思考过程" },
              { type: "text", content: "中间说明" },
              { type: "text", content: "已完成修复，全部测试通过。" },
            ],
          },
        ]),
      },
    });
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    const result = store.listComments(task.id).find((c) => c.kind === "result");
    expect(result?.author).toBe("ai");
    // 取最后一条 assistant 消息的最后一个文本块（跳过 reasoning/中间文本）
    expect(result?.content).toBe("已完成修复，全部测试通过。");
    scheduler.stop();
  });

  it("执行会话无文本块时 result 评论回退固定系统文案", async () => {
    const { store, scheduler } = makeScheduler({
      runner: {
        getMessages: vi.fn(async () => [
          { role: "assistant", blocks: [{ type: "reasoning", content: "只有思考" }] },
        ]),
      },
    });
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    const result = store.listComments(task.id).find((c) => c.kind === "result");
    expect(result?.author).toBe("system");
    expect(result?.content).toContain("执行完成");
    scheduler.stop();
  });

  it("旁路复核失败重试一次后跳过，task 仍待审核且评论标注", async () => {
    const { store, scheduler, runner } = makeScheduler({
      runner: {
        // 旁路提问失败（规划会话无 agent / SDK 不可用）
        askBtw: vi.fn(async () => {
          throw new Error("askBtw failed");
        }),
      },
    });
    const todo = store.createTodo({ title: "t", source: "session" });
    store.setPlanningSessionId(todo.id, "plan-1");
    const task = store.createTask(todo.id, { title: "k", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => {
      const notes = store.listComments(task.id).filter((c) => c.content.includes("AI 复核失败"));
      expect(notes.length).toBe(1);
    });
    // 重试恰好一次（共 2 次 askBtw 尝试）
    expect((runner.askBtw as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    // task 不被阻塞在待审核之外
    expect(store.getTask(task.id)?.status).toBe("review");
    scheduler.stop();
  });

  it("task 进待审核广播 todo:notify（含 todoId/taskId/标题）", async () => {
    const { store, scheduler, hub } = makeScheduler({});
    const todo = store.createTodo({ title: "T-todo", source: "session", priority: "p0" });
    const task = store.createTask(todo.id, { title: "K-task", workdir: "/p" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() =>
      expect((hub.broadcastAll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1),
    );
    const event = (hub.broadcastAll as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.type).toBe("todo:notify");
    expect(event.todoId).toBe(todo.id);
    expect(event.taskId).toBe(task.id);
    expect(event.todoTitle).toBe("T-todo");
    expect(event.taskTitle).toBe("K-task");
    expect(event.priority).toBe("p0");
    scheduler.stop();
  });

  it("approve：task 已完成 + 删执行会话 + worktree 保留 + 执行记录留会话 id", async () => {
    // 真实 git 仓库 fixture（worktree 已建）
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-approve-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    const { store, scheduler, runner, sessionStore } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: repo });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    expect(fs.existsSync(path.join(repo, ".wave", "worktrees", task.id))).toBe(true);
    // 执行记录已留 sessionId（markRunning 时写入）
    expect(store.listRuns(task.id)[0].sessionId).toBe(execId);
    // 待审核后 approve
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    // 执行记录已回填 agentSessionId（waveSessionId）
    const run = store.listRuns(task.id)[0];
    expect(run.sessionId).toBe(execId);
    expect(run.agentSessionId).toMatch(/^wave-/);
    await scheduler.approve(task.id);
    const approved = store.getTask(task.id)!;
    expect(approved.status).toBe("completed");
    // worktree 保留（目录 + task 字段）
    expect(approved.worktreeName).toBe(task.id);
    expect(approved.worktreeRepoRoot).toBe(fs.realpathSync(repo));
    expect(fs.existsSync(path.join(repo, ".wave", "worktrees", task.id))).toBe(true);
    // 执行会话引用已清，但执行记录里保留 sessionId
    expect(approved.executionSessionId).toBeUndefined();
    expect(store.listRuns(task.id)[0].sessionId).toBe(execId);
    expect(runner.disposeSession).toHaveBeenCalledWith(execId);
    expect(sessionStore.delete).toHaveBeenCalledWith(execId);
    scheduler.stop();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("task 指定 baseBranch 时 worktree 从该分支创建（非默认分支）", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-branch-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
    // 造一个 develop 分支（带不同内容，验证 worktree 从它 checkout）
    execFileSync("git", ["checkout", "-b", "develop"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "dev.txt"), "dev\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "dev"], { cwd: repo });
    execFileSync("git", ["checkout", "main"], { cwd: repo });

    const { store, scheduler } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: repo, baseBranch: "develop" });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const wtPath = path.join(repo, ".wave", "worktrees", task.id);
    expect(fs.existsSync(wtPath)).toBe(true);
    // worktree 工作区包含 develop 专属内容（dev.txt），证明从 develop checkout
    expect(fs.existsSync(path.join(wtPath, "dev.txt"))).toBe(true);
    scheduler.stop();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("非执行中取消（待审核）保留 worktree（仅审核通过/执行中取消才删）", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "muse-todo-cancel-keep-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    const { store, scheduler } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const task = store.createTask(todo.id, { title: "k", workdir: repo });
    scheduler.start();
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("running"));
    const execId = store.getTask(task.id)?.executionSessionId!;
    scheduler.handleTurnSettled(execId, { ok: true });
    await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe("review"));
    // 待审核取消：worktree 保留（T6 取消/继续执行保留）
    await scheduler.cancel(task.id);
    expect(store.getTask(task.id)?.status).toBe("cancelled");
    expect(fs.existsSync(path.join(repo, ".wave", "worktrees", task.id))).toBe(true);
    scheduler.stop();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("openPlanningSession 懒创建并复用：首次建会话、二次复用、todo 记录 planningSessionId", async () => {
    const { store, scheduler, sessionStore } = makeScheduler({});
    const todo = store.createTodo({ title: "t", source: "session" });
    const first = scheduler.openPlanningSession(todo.id);
    expect(first).toBeTruthy();
    expect(store.getTodo(todo.id)?.planningSessionId).toBe(first!.sessionId);
    expect(sessionStore.create).toHaveBeenCalledTimes(1);
    // 规划会话 workdir 统一为 <museHome>/personal（不再每次新建随机 projects/<date>-uid）
    expect(first!.workdir.endsWith(path.join(".muse-work", "personal"))).toBe(true);
    expect(fs.existsSync(first!.workdir)).toBe(true);
    // 再次打开复用同一会话
    const second = scheduler.openPlanningSession(todo.id);
    expect(second!.sessionId).toBe(first!.sessionId);
    expect(sessionStore.create).toHaveBeenCalledTimes(1);
  });

  it("openPlanningSession 创建的会话带 todo 系统上下文（id/标题/描述）", async () => {
    const { store, scheduler, sessionStore } = makeScheduler({});
    const todo = store.createTodo({
      title: "重构登录",
      description: "把登录逻辑抽成独立模块",
      source: "session",
    });
    scheduler.openPlanningSession(todo.id);

    const input = vi.mocked(sessionStore.create).mock.calls[0][0] as {
      systemPrompt?: string;
    };
    expect(input.systemPrompt).toBeTruthy();
    expect(input.systemPrompt).toContain(todo.id);
    expect(input.systemPrompt).toContain("重构登录");
    expect(input.systemPrompt).toContain("把登录逻辑抽成独立模块");
  });

  it("openPlanningSession 用 todo 绑定 workdir；未绑定回退 personal", async () => {
    const { store, scheduler, sessionStore } = makeScheduler({});
    const bound = store.createTodo({
      title: "t",
      source: "session",
      workdir: "/tmp/bound-repo",
    });
    const opened = scheduler.openPlanningSession(bound.id);
    expect(opened!.workdir).toBe("/tmp/bound-repo");
    expect(fs.existsSync(opened!.workdir)).toBe(true);
    const input = vi.mocked(sessionStore.create).mock.calls[0][0] as {
      workdir?: string;
    };
    expect(input.workdir).toBe("/tmp/bound-repo");

    const unbound = store.createTodo({ title: "t2", source: "session" });
    const opened2 = scheduler.openPlanningSession(unbound.id);
    expect(opened2!.workdir.endsWith(path.join(".muse-work", "personal"))).toBe(true);
  });
});
