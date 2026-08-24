/**
 * Todo/Task 常驻执行调度器（spec 2026-08-21，Seam 5）。
 *
 * - 全局并发上限 3，FIFO 排队（排队中 task 仍显示「待执行」，排队状态在 run.queued）
 * - 创建 task 即入队；手动「开始执行/继续执行」→ enqueue
 * - 执行会话懒创建（permissionMode bypassPermissions，不隐藏，每 task 固定一个复用）
 * - git workdir 自动建 worktree（<repo>/.wave/worktrees/<taskId>）；非 git 直接执行
 * - turn 结束（onTurnSettled，含报错/中断）→ task 转待审核 + system result 评论
 * - 重启恢复：queued run 落盘自动续跑；running run 标记中断回待执行
 */

import fs from "node:fs";
import path from "node:path";
import type { ProviderRegistry } from "@muse-work/provider";
import { DEFAULT_ACTIVE_MODEL_ID, getTodoWorkdir } from "@muse-work/provider";
import type { SessionRunner } from "./sessionRunner.js";
import type { SessionStore } from "./sessionStore.js";
import type { Task, Todo, TodoStore } from "./todoStore.js";
import type { WsHub } from "./wsHub.js";
import {
  ensureWorktree,
  isGitRepo,
  removeWorktree,
  type WorktreeRef,
} from "../utils/gitWorktree.js";
import { getLogger } from "../utils/logger.js";

export interface TodoSchedulerOptions {
  store: TodoStore;
  runner: SessionRunner;
  sessionStore: SessionStore;
  registry: ProviderRegistry;
  home: string;
  /** WS 通知广播（task 进待审核时通知 webview）。 */
  hub?: WsHub;
  /** 调度扫描间隔（默认 2s）。 */
  tickMs?: number;
  /** 全局并发上限（默认 3）。 */
  maxConcurrent?: number;
}

export interface TodoScheduler {
  start(): void;
  stop(): void;
  /** 手动「开始执行/继续执行」：入队并立即尝试启动。 */
  enqueue(taskId: string): void;
  /** 取消 task：中止执行会话（若执行中）、标已取消、删 worktree（仅执行中取消删）。 */
  cancel(taskId: string): Promise<void>;
  /** 审核通过：task 已完成 + 删执行会话（worktree 保留供排查）。 */
  approve(taskId: string): Promise<void>;
  /** 打开 todo 的规划会话（首次懒创建，每 todo 固定一个）。 */
  openPlanningSession(todoId: string): { sessionId: string; workdir: string } | null;
  /** 已存在 worktree 的 task，计算执行目录。 */
  worktreePathOf(task: Task): string | null;
  /** turn 结束回调入口（appContext 绑定到 runner 的 onTurnSettled）。 */
  handleTurnSettled(sessionId: string, result: { ok: boolean; error?: string }): void;
}

function buildPrompt(task: Task, workdir: string): string {
  return [
    `执行 Todo/Task 任务「${task.title}」`,
    ``,
    task.description ? `任务描述（markdown）：\n${task.description}` : "（无描述）",
    ``,
    `工作目录：${workdir}`,
    ``,
    `请完整执行该任务。完成后用中文总结：做了什么、改了哪些文件、测试/验证是否通过；如有阻塞或需要人工确认的事项，明确说明。`,
  ].join("\n");
}

/** 规划会话的系统上下文：注入 todo 基本信息（id/标题/描述），agent 从创建起即了解目标。 */
function buildTodoSystemPrompt(todo: Todo): string {
  return [
    "当前会话是 TODO 的规划会话。以下是该 TODO 的基本信息：",
    `TODO ID：${todo.id}`,
    `标题：${todo.title}`,
    todo.description ? `描述：${todo.description}` : "描述：（无）",
  ].join("\n");
}

export function createTodoScheduler(options: TodoSchedulerOptions): TodoScheduler {
  const { store, runner, sessionStore, registry, home, hub } = options;
  const tickMs = options.tickMs ?? 2000;
  const maxConcurrent = options.maxConcurrent ?? 3;
  /** 本进程内正在执行的 taskId（恢复扫描排除 + 并发计数）。 */
  const activeRunning = new Set<string>();
  /** 复核注入中的会话：sessionId -> taskId（turn 结束后取 AI 结论写 note 评论）。 */
  const pendingReviews = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;

  function allTasks(): Task[] {
    const out: Task[] = [];
    for (const todo of store.listTodos()) {
      out.push(...store.listTasks(todo.id));
    }
    return out;
  }

  /** queued run 按 createdAt 排序（FIFO）。 */
  function queuedRunsSorted(): Array<{ runId: string; taskId: string; createdAt: number }> {
    const runs: Array<{ runId: string; taskId: string; createdAt: number }> = [];
    for (const task of allTasks()) {
      for (const run of store.listRuns(task.id)) {
        if (run.status === "queued") {
          runs.push({ runId: run.id, taskId: task.id, createdAt: run.createdAt });
        }
      }
    }
    return runs.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 重启恢复：磁盘上 running 但本进程未启动的 run → 中断回待执行 + 评论（不自动重跑）。 */
  function recoverInterrupted(): void {
    for (const task of allTasks()) {
      if (task.status !== "running" || activeRunning.has(task.id)) continue;
      const active = store.listRuns(task.id).some((r) => r.status === "running");
      if (!active) continue;
      getLogger().info("recovering interrupted task run", { taskId: task.id });
      // 回待执行 + run interrupted + system 评论（中断不自动重跑，等手动「开始执行」）
      store.updateTaskStatus(task.id, "pending");
      const run = store.listRuns(task.id).find((r) => r.status === "running");
      if (run) store.updateRunStatus(run.id, "interrupted");
      store.addComment(task.id, {
        author: "system",
        kind: "result",
        content: "⚠️ 上次执行中断（进程退出），已回到待执行，可手动触发「开始执行」。",
      });
    }
  }

  /** 待执行 task 无活跃 run 且最近未被中断 → 建 queued run（创建即入队；中断/取消过的等手动）。 */
  function enqueueReadyTasks(): void {
    for (const task of allTasks()) {
      if (task.status !== "pending") continue;
      const runs = store.listRuns(task.id);
      const last = runs[runs.length - 1];
      if (last && last.status === "interrupted") continue;
      store.enqueueTask(task.id);
    }
  }

  async function launch(taskId: string): Promise<void> {
    const task = store.getTask(taskId);
    if (!task) return;
    // worktree：已建则复用路径；git 项目首次执行时创建；非 git 直接用 workdir
    let workdir = task.workdir;
    if (task.worktreeName && task.worktreeRepoRoot) {
      workdir = path.join(
        task.worktreeRepoRoot,
        ".wave",
        "worktrees",
        task.worktreeName,
      );
    } else if (isGitRepo(task.workdir)) {
      const wt = await ensureWorktree(task.id, task.workdir, task.baseBranch);
      store.setTaskWorktree(task.id, {
        name: wt.name,
        repoRoot: wt.repoRoot,
        workdir: wt.path,
      });
      workdir = wt.path;
    }

    // 执行会话：每 task 固定一个，懒创建，复用
    let execSessionId = task.executionSessionId;
    if (!execSessionId || !sessionStore.get(execSessionId)) {
      const active = registry.getActive();
      const model = active.modelId ?? DEFAULT_ACTIVE_MODEL_ID;
      const session = sessionStore.create({
        workdir,
        model,
        permissionMode: "bypassPermissions",
        worktreeName: task.worktreeName,
        worktreeRepoRoot: task.worktreeRepoRoot,
        baseBranch: task.baseBranch,
        // 执行会话标题 = task 标题，侧栏一眼认出
        title: task.title,
      });
      execSessionId = session.id;
    }

    const updated = store.markRunning(taskId, execSessionId);
    if (!updated) return; // 已被并发路径占用（非待执行）

    getLogger().info("todo task launched", {
      taskId,
      sessionId: execSessionId,
      workdir,
    });
    await runner.sendMessage(execSessionId, buildPrompt(task, workdir));
  }

  async function tick(): Promise<void> {
    enqueueReadyTasks();
    for (const { taskId } of queuedRunsSorted()) {
      if (activeRunning.size >= maxConcurrent) break;
      if (activeRunning.has(taskId)) continue;
      const task = store.getTask(taskId);
      if (!task || task.status !== "pending") continue;
      activeRunning.add(taskId);
      void launch(taskId).catch((err) => {
        activeRunning.delete(taskId);
        const message = err instanceof Error ? err.message : String(err);
        getLogger().warn("todo task launch failed", { taskId, error: message });
        store.completeRun(taskId, { ok: false, error: message });
        void tick();
      });
    }
  }

  /** 取执行会话最后一条 assistant 消息的最后一个文本块（AI 执行总结）；无则 undefined。 */
  async function extractFinalTextBlock(
    sessionId: string,
  ): Promise<string | undefined> {
    try {
      const messages = await runner.getMessages(sessionId);
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as {
          role?: string;
          blocks?: Array<{ type?: string; content?: string }>;
        };
        if (m?.role !== "assistant") continue;
        const texts = (m.blocks ?? []).filter(
          (b) => b.type === "text" && Boolean(b.content?.trim()),
        );
        const last = texts[texts.length - 1];
        if (last?.content?.trim()) return last.content.trim();
        // 该 assistant 消息无文本块 → 继续往前找上一条 assistant
      }
    } catch {
      // 读失败按无总结处理（回退固定文案）
    }
    return undefined;
  }

  /** 执行完成：AI 执行总结（最后文本块）作为 result 评论内容。 */
  async function finalizeRun(
    taskId: string,
    execSessionId: string,
    result: { ok: boolean; error?: string },
  ): Promise<void> {
    // 执行记录回填 agent 会话 id（waveSessionId）：审核通过删会话后仍能定位 SDK jsonl
    const waveSessionId = sessionStore.get(execSessionId)?.waveSessionId;
    if (waveSessionId) {
      store.setRunSessionIds(taskId, { agentSessionId: waveSessionId });
    }
    const summary = result.ok
      ? await extractFinalTextBlock(execSessionId)
      : undefined;
    store.completeRun(taskId, { ...result, summary });
  }

  /** turn 结束回调（runner 注入）：执行中 task → 待审核 + result 评论 + 释放槽位。 */
  function onTurnSettled(sessionId: string, result: { ok: boolean; error?: string }): void {
    // 复核注入的 turn 结束：取 AI 结论写 note 评论（不改变 task 状态）
    const reviewTaskId = pendingReviews.get(sessionId);
    if (reviewTaskId !== undefined) {
      pendingReviews.delete(sessionId);
      void captureReviewConclusion(sessionId, reviewTaskId);
      return;
    }
    const task = store.getTaskByExecutionSession(sessionId);
    if (!task || task.status !== "running") return;
    activeRunning.delete(task.id);
    getLogger().info("todo task turn settled", {
      taskId: task.id,
      sessionId,
      ok: result.ok,
    });
    void finalizeRun(task.id, sessionId, result).then(() => {
      if (store.getTask(task.id)?.status === "review") {
        void triggerAiReview(task.id);
        notifyReviewPending(task.id);
      }
    });
    void tick();
  }

  /** task 进待审核 → 通知 webview（只通知这一个事件）。 */
  function notifyReviewPending(taskId: string): void {
    if (!hub) return;
    const task = store.getTask(taskId);
    const todo = task ? store.getTodo(task.todoId) : undefined;
    if (!task || !todo) return;
    hub.broadcastAll({
      type: "todo:notify",
      todoId: todo.id,
      taskId: task.id,
      todoTitle: todo.title,
      taskTitle: task.title,
      priority: todo.priority,
    });
  }

  /** 构造复核注入消息（带系统注入标记，经 runner source 参数包裹）。 */
  function buildReviewPrompt(task: Task, todo: Todo): string {
    const result = store.listComments(task.id).find((c) => c.kind === "result");
    return [
      "【Todo/Task 进度同步 + AI 复核】",
      `Todo「${todo.title}」下的 task「${task.title}」已执行完，进入待审核。`,
      ``,
      `执行结果：${result?.content ?? "（无执行结果记录）"}`,
      ``,
      `请以审核者视角复核该 task 的执行结果：改动是否合理、是否覆盖测试、有无明显问题或遗漏。`,
      `直接给出复核结论（供人工审核参考，不改变任务状态）。`,
    ].join("\n");
  }

  /** task 进待审核后：向规划会话注入进度消息触发 AI 复核（重试一次，失败跳过并标注）。 */
  async function triggerAiReview(taskId: string): Promise<void> {
    const task = store.getTask(taskId);
    if (!task) return;
    const todo = store.getTodo(task.todoId);
    if (!todo?.planningSessionId) return; // 无规划会话（T8 懒创建后自动生效）
    const sessionId = todo.planningSessionId;
    const content = buildReviewPrompt(task, todo);
    try {
      await runner.sendMessage(sessionId, content, undefined, "system-inject");
    } catch {
      try {
        await runner.sendMessage(sessionId, content, undefined, "system-inject");
      } catch {
        store.addComment(task.id, {
          author: "system",
          kind: "note",
          content: "⚠️ AI 复核失败（注入失败，已重试一次）。任务不阻塞，可人工审核。",
        });
        return;
      }
    }
    pendingReviews.set(sessionId, task.id);
  }

  /** 读复核注入会话的最新 assistant 文本，写 note 评论（结论仅供参考）。 */
  async function captureReviewConclusion(sessionId: string, taskId: string): Promise<void> {
    let conclusion = "";
    try {
      const messages = await runner.getMessages(sessionId);
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as { role?: string; blocks?: Array<{ type?: string; content?: string }> };
        if (m?.role === "assistant") {
          const text = (m.blocks ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.content ?? "")
            .join("");
          if (text.trim()) {
            conclusion = text.trim();
            break;
          }
        }
      }
    } catch {
      // 读失败按无结论处理
    }
    if (conclusion) {
      store.addComment(taskId, {
        author: "ai",
        kind: "note",
        content: `【AI 复核】${conclusion}`,
      });
    } else {
      store.addComment(taskId, {
        author: "system",
        kind: "note",
        content: "⚠️ AI 复核失败（未生成结论）。任务不阻塞，可人工审核。",
      });
    }
  }

  /** 执行中取消：中止会话 + 删 worktree（执行中取消立即删，用户已拍板）；非执行中取消保留 worktree。 */
  async function cancel(taskId: string): Promise<void> {
    const task = store.getTask(taskId);
    if (!task) return;
    const wasRunning = task.status === "running";
    const execSessionId = task.executionSessionId;
    // 先标已取消（onTurnSettled 回调看到非执行中会跳过），再中止会话
    store.cancelTask(taskId);
    activeRunning.delete(taskId);
    if (wasRunning && execSessionId && sessionStore.get(execSessionId)) {
      try {
        await runner.abortMessage(execSessionId);
      } catch {
        // abort 失败不阻塞取消
      }
    }
    // 仅执行中取消时删除 worktree（T6：取消/继续执行保留 worktree）
    if (wasRunning && task.worktreeName && task.worktreeRepoRoot) {
      const ref: WorktreeRef = {
        name: task.worktreeName,
        path: path.join(task.worktreeRepoRoot, ".wave", "worktrees", task.worktreeName),
        branch: `worktree-${task.worktreeName}`,
        repoRoot: task.worktreeRepoRoot,
      };
      try {
        await removeWorktree(ref);
      } catch {
        getLogger().warn("worktree remove failed", { taskId });
      }
    }
    void tick();
  }

  /** 审核通过：task 已完成 + 删执行会话（worktree 保留供排查/复核，见 todoStore.approveTask）。 */
  async function approve(taskId: string): Promise<void> {
    const task = store.getTask(taskId);
    if (!task) return;
    const execSessionId = task.executionSessionId;
    // 执行会话删除（runtime + 记录）
    if (execSessionId) {
      try {
        await runner.disposeSession(execSessionId);
      } catch {
        getLogger().warn("execution session dispose failed", { taskId, execSessionId });
      }
      try {
        sessionStore.delete(execSessionId);
      } catch {
        getLogger().warn("execution session delete failed", { taskId, execSessionId });
      }
    }
    store.approveTask(task.id);
    void tick();
  }

  return {
    start() {
      if (started) return;
      started = true;
      recoverInterrupted();
      void tick();
      timer = setInterval(() => {
        void tick();
      }, tickMs);
      getLogger().info("todo scheduler started", { maxConcurrent, tickMs });
    },

    stop() {
      started = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    enqueue(taskId) {
      // 待执行=开始执行；待审核=继续执行（先回待执行再入队）
      const task = store.getTask(taskId);
      if (task?.status === "review") {
        store.updateTaskStatus(taskId, "pending");
      }
      store.enqueueTask(taskId);
      void tick();
    },

    cancel,

    approve,

    openPlanningSession(todoId) {
      const todo = store.getTodo(todoId);
      if (!todo) return null;
      // 已创建且会话仍存在 → 复用
      if (todo.planningSessionId && sessionStore.get(todo.planningSessionId)) {
        const s = sessionStore.get(todo.planningSessionId)!;
        return { sessionId: s.id, workdir: s.workdir };
      }
      const active = registry.getActive();
      const model = active.modelId ?? DEFAULT_ACTIVE_MODEL_ID;
      // todo 规划会话 workdir 统一为 <museHome>/personal（用户指定，固定目录）
      const workdir = getTodoWorkdir(home);
      fs.mkdirSync(workdir, { recursive: true });
      const session = sessionStore.create({
        workdir,
        model,
        title: todo.title,
        // 系统上下文注入 todo 基本信息：agent 从会话创建起就了解目标（id/标题/描述）
        systemPrompt: buildTodoSystemPrompt(todo),
      });
      store.setPlanningSessionId(todoId, session.id);
      getLogger().info("todo planning session created", {
        todoId,
        sessionId: session.id,
      });
      return { sessionId: session.id, workdir: session.workdir };
    },

    worktreePathOf(task) {
      if (task.worktreeName && task.worktreeRepoRoot) {
        return path.join(task.worktreeRepoRoot, ".wave", "worktrees", task.worktreeName);
      }
      return null;
    },

    handleTurnSettled(sessionId, result) {
      onTurnSettled(sessionId, result);
    },
  };
}
