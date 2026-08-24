import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";

export type TodoPriority = "p0" | "p1" | "p2";
export type TodoSource = "session" | "manual" | "popo" | "internal";
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskStatus = "pending" | "running" | "review" | "completed" | "cancelled";

export type CommentAuthor = "user" | "ai" | "system";
export type CommentKind = "note" | "result";
export type RunStatus = "queued" | "running" | "finished" | "canceled" | "interrupted";

export interface Comment {
  id: string;
  taskId: string;
  author: CommentAuthor;
  kind: CommentKind;
  content: string;
  createdAt: number;
}

export interface Run {
  id: string;
  taskId: string;
  status: RunStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** 执行会话 id（Session.id，即 task.executionSessionId）。 */
  sessionId?: string;
  /** SDK 会话 id（waveSessionId）：agent 创建后回填，用于定位 SDK 落盘 jsonl。 */
  agentSessionId?: string;
}

export interface Todo {
  id: string;
  title: string;
  description: string;
  priority: TodoPriority;
  source: TodoSource;
  status: TodoStatus;
  /** 标签（trim/去重/小写规范化后的小写字符串）。 */
  tags: string[];
  /** 绑定的工作目录：规划会话开在这里，新 task 未指定 workdir 时继承；未绑定则用默认 personal。 */
  workdir?: string;
  planningSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  todoId: string;
  title: string;
  description: string;
  status: TaskStatus;
  workdir: string;
  worktreeName?: string;
  /** Worktree 所在主仓库根（删除 worktree 时用）。 */
  worktreeRepoRoot?: string;
  /** worktree 的 base 分支（创建 worktree 时从该分支 checkout；缺省自动推断）。 */
  baseBranch?: string;
  /**
   * git 项目是否用 worktree 隔离执行。缺省 undefined = 隔离（现有行为）；
   * 显式 false = 即使 git 项目也直接在原 workdir 执行。
   */
  worktreeEnabled?: boolean;
  executionSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  priority?: TodoPriority;
  source: TodoSource;
  tags?: string[];
  /** 绑定工作目录（可选；未绑定则规划会话用默认 personal，task 创建时 workdir 仍必填）。 */
  workdir?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  workdir: string;
  /** worktree 的 base 分支（创建 worktree 时从该分支 checkout；缺省自动推断）。 */
  baseBranch?: string;
  /** git 项目是否用 worktree 隔离执行；缺省 true（隔离）。显式 false = 直接在原目录执行。 */
  worktreeEnabled?: boolean;
}

export interface TodoStore {
  createTodo(input: CreateTodoInput): Todo;
  getTodo(id: string): Todo | undefined;
  listTodos(): Todo[];
  /** 全部 todo（含已完成/已取消），不做状态过滤。 */
  listAllTodos(): Todo[];
  updateTodo(
    id: string,
    patch: Partial<Pick<Todo, "title" | "description" | "priority" | "tags">>,
  ): Todo | undefined;
  updateTodoStatus(id: string, status: TodoStatus): Todo | undefined;
  setPlanningSessionId(id: string, planningSessionId: string): Todo | undefined;
  cancelTodo(id: string): Todo | undefined;
  /**
   * 手动标记 todo 已完成（入口：页面操作 / 规划会话 AI 指令）。
   * 有 task 处于待执行/执行中/待审核（未到终态）→ 拒绝，返回 undefined。
   */
  completeTodo(id: string): Todo | undefined;
  createTask(todoId: string, input: CreateTaskInput): Task;
  getTask(id: string): Task | undefined;
  listTasks(todoId: string): Task[];
  updateTask(
    id: string,
    patch: Partial<Pick<Task, "title" | "description">>,
  ): Task | undefined;
  updateTaskStatus(id: string, status: TaskStatus): Task | undefined;
  /** 记录 task 的 worktree 信息（调度器建 worktree 后调用；workdir 同步为 worktree 路径）。 */
  setTaskWorktree(
    id: string,
    info: { name: string; repoRoot: string; workdir?: string },
  ): Task | undefined;
  addComment(
    taskId: string,
    input: { author: CommentAuthor; kind: CommentKind; content: string },
  ): Comment;
  listComments(taskId: string): Comment[];
  createRun(taskId: string, input: { status: RunStatus }): Run;
  listRuns(taskId: string): Run[];
  updateRunStatus(id: string, status: RunStatus): Run | undefined;
  /** 给 task 最近一个活跃 run 记录会话 id（Session.id）与 agent 会话 id（waveSessionId）。 */
  setRunSessionIds(
    taskId: string,
    ids: { sessionId?: string; agentSessionId?: string },
  ): Run | undefined;
  /** 按执行会话 id 找 task（调度器 turn 结束回调用）。 */
  getTaskByExecutionSession(sessionId: string): Task | undefined;
  /** 待执行 task 入队：建 queued run（已有活跃 run 则复用，返回 undefined 表示不可入队）。 */
  enqueueTask(taskId: string): Run | undefined;
  /** 出队执行：task 转执行中 + queued run 转 running + 记录 executionSessionId。 */
  markRunning(taskId: string, executionSessionId: string): Task | undefined;
  /** 执行结束（含报错/中断）：task 转待审核 + run finished + result 评论；todo 全部结束则已完成。 */
  completeRun(
    taskId: string,
    input?: { ok?: boolean; error?: string; summary?: string },
  ): Task | undefined;
  /** 取消 task（任意未归档状态）：已取消 + 未结束 run 标 canceled。 */
  cancelTask(taskId: string): Task | undefined;
  /** 审核通过：task 已完成 + 清 worktree/执行会话引用（T6 清理后调用）。 */
  approveTask(taskId: string): Task | undefined;
}

export interface CreateTodoStoreOptions {
  home?: string;
}

function dbRoot(home: string): string {
  return path.join(getMuseHomeDir(home), "db");
}

function todosIndexPath(home: string): string {
  return path.join(dbRoot(home), "todos.json");
}

function todoDir(home: string, todoId: string): string {
  return path.join(dbRoot(home), "todos", todoId);
}

function tasksPath(home: string, todoId: string): string {
  return path.join(todoDir(home, todoId), "tasks.json");
}

function commentsPath(home: string, todoId: string): string {
  return path.join(todoDir(home, todoId), "comments.json");
}

function runsPath(home: string, todoId: string): string {
  return path.join(todoDir(home, todoId), "runs.json");
}

const PRIORITY_ORDER: TodoPriority[] = ["p0", "p1", "p2"];

/** 标签规范化：trim + 去空 + 小写 + 去重（保序）。 */
function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpPath = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, file);
}

export function createTodoStore(options: CreateTodoStoreOptions = {}): TodoStore {
  const home = options.home ?? process.env.MUSE_HOME ?? os.homedir();
  const todos = new Map<string, Todo>();
  const tasks = new Map<string, Task>(); // key: taskId -> task（含 todoId）
  const comments = new Map<string, Comment[]>(); // key: taskId -> comments
  const runs = new Map<string, Run[]>(); // key: taskId -> runs

  // 载入磁盘
  const indexFile = todosIndexPath(home);
  const index = readJson<{ version: number; todos: Todo[] }>(indexFile, {
    version: 1,
    todos: [],
  });
  for (const todo of index.todos) {
    todos.set(todo.id, todo);
    const taskFile = tasksPath(home, todo.id);
    const taskList = readJson<{ version: number; tasks: Task[] }>(taskFile, {
      version: 1,
      tasks: [],
    });
    for (const task of taskList.tasks) {
      tasks.set(task.id, task);
    }
    const commentList = readJson<{ version: number; comments: Comment[] }>(
      commentsPath(home, todo.id),
      { version: 1, comments: [] },
    );
    for (const c of commentList.comments) {
      const list = comments.get(c.taskId) ?? [];
      list.push(c);
      comments.set(c.taskId, list);
    }
    const runList = readJson<{ version: number; runs: Run[] }>(
      runsPath(home, todo.id),
      { version: 1, runs: [] },
    );
    for (const r of runList.runs) {
      const list = runs.get(r.taskId) ?? [];
      list.push(r);
      runs.set(r.taskId, list);
    }
  }

  function persistTodos(): void {
    writeJson(todosIndexPath(home), {
      version: 1,
      todos: [...todos.values()].map((t) => ({ ...t })),
    });
  }

  function persistTasks(todoId: string): void {
    writeJson(tasksPath(home, todoId), {
      version: 1,
      tasks: [...tasks.values()].filter((t) => t.todoId === todoId),
    });
  }

  function persistComments(todoId: string): void {
    writeJson(commentsPath(home, todoId), {
      version: 1,
      comments: [...comments.values()].flat().filter((c) => {
        const task = tasks.get(c.taskId);
        return task?.todoId === todoId;
      }),
    });
  }

  function persistRuns(todoId: string): void {
    writeJson(runsPath(home, todoId), {
      version: 1,
      runs: [...runs.values()].flat().filter((r) => {
        const task = tasks.get(r.taskId);
        return task?.todoId === todoId;
      }),
    });
  }

  function touch(todo: Todo): Todo {
    todo.updatedAt = Date.now();
    return todo;
  }

  /** 最新一条未结束（queued/running）的 run；无则 undefined。 */
  function latestActiveRun(taskId: string): Run | undefined {
    const list = runs.get(taskId) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.status === "queued" || r.status === "running") return r;
    }
    return undefined;
  }

  /** task 最近一条 run 是否为 interrupted（中断恢复后不自动重跑，等手动触发）。 */
  function lastRunInterrupted(taskId: string): boolean {
    const list = runs.get(taskId) ?? [];
    const last = list[list.length - 1];
    return last?.status === "interrupted";
  }

  function addCommentInternal(
    taskId: string,
    input: { author: CommentAuthor; kind: CommentKind; content: string },
  ): Comment {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const comment: Comment = {
      id: crypto.randomUUID(),
      taskId,
      author: input.author,
      kind: input.kind,
      content: input.content,
      createdAt: Date.now(),
    };
    const list = comments.get(taskId) ?? [];
    list.push(comment);
    comments.set(taskId, list);
    persistComments(task.todoId);
    return { ...comment };
  }

  function createRunInternal(taskId: string, input: { status: RunStatus }): Run {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const run: Run = {
      id: crypto.randomUUID(),
      taskId,
      status: input.status,
      createdAt: Date.now(),
    };
    if (run.status === "running") run.startedAt = run.createdAt;
    const list = runs.get(taskId) ?? [];
    list.push(run);
    runs.set(taskId, list);
    persistRuns(task.todoId);
    return { ...run };
  }

  function updateRunStatusInternal(id: string, status: RunStatus): Run | undefined {
    for (const list of runs.values()) {
      const run = list.find((r) => r.id === id);
      if (!run) continue;
      run.status = status;
      if (status === "running" && run.startedAt === undefined) {
        run.startedAt = Date.now();
      }
      if ((status === "finished" || status === "canceled" || status === "interrupted") && run.finishedAt === undefined) {
        run.finishedAt = Date.now();
      }
      const task = tasks.get(run.taskId);
      if (task) persistRuns(task.todoId);
      return { ...run };
    }
    return undefined;
  }

  return {
    createTodo(input): Todo {
      const now = Date.now();
      const todo: Todo = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "p1",
        source: input.source,
        status: "pending",
        tags: normalizeTags(input.tags),
        ...(input.workdir ? { workdir: input.workdir } : {}),
        createdAt: now,
        updatedAt: now,
      };
      todos.set(todo.id, todo);
      persistTodos();
      return { ...todo };
    },

    getTodo(id) {
      const todo = todos.get(id);
      return todo ? { ...todo } : undefined;
    },

    listTodos() {
      return [...todos.values()]
        .filter((t) => t.status !== "completed" && t.status !== "cancelled")
        .sort(
          (a, b) =>
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
            a.createdAt - b.createdAt,
        )
        .map((t) => ({ ...t }));
    },

    listAllTodos() {
      return [...todos.values()]
        .sort(
          (a, b) =>
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
            a.createdAt - b.createdAt,
        )
        .map((t) => ({ ...t }));
    },

    updateTodo(id, patch) {
      const todo = todos.get(id);
      if (!todo || todo.status !== "pending") return undefined;
      if (patch.title !== undefined) todo.title = patch.title;
      if (patch.description !== undefined) todo.description = patch.description;
      if (patch.priority !== undefined) todo.priority = patch.priority;
      if (patch.tags !== undefined) todo.tags = normalizeTags(patch.tags);
      touch(todo);
      persistTodos();
      return { ...todo };
    },

    updateTodoStatus(id, status) {
      const todo = todos.get(id);
      if (!todo) return undefined;
      todo.status = status;
      touch(todo);
      persistTodos();
      return { ...todo };
    },

    setPlanningSessionId(id, planningSessionId) {
      const todo = todos.get(id);
      if (!todo) return undefined;
      todo.planningSessionId = planningSessionId;
      touch(todo);
      persistTodos();
      return { ...todo };
    },

    cancelTodo(id) {
      const todo = todos.get(id);
      if (!todo) return undefined;
      todo.status = "cancelled";
      touch(todo);
      persistTodos();
      // 级联取消未完成任务（T6 完整；此处先标已取消）
      for (const task of tasks.values()) {
        if (task.todoId === id && task.status !== "completed") {
          task.status = "cancelled";
          task.updatedAt = Date.now();
        }
      }
      persistTasks(id);
      return { ...todo };
    },

    completeTodo(id) {
      const todo = todos.get(id);
      if (!todo) return undefined;
      // 已取消的 todo 不可再标记完成
      if (todo.status === "cancelled") return undefined;
      // 有 task 未到终态（待执行/执行中/待审核）→ 拒绝标记完成
      for (const task of tasks.values()) {
        if (
          task.todoId === id &&
          task.status !== "completed" &&
          task.status !== "cancelled"
        ) {
          return undefined;
        }
      }
      todo.status = "completed";
      touch(todo);
      persistTodos();
      return { ...todo };
    },

    createTask(todoId, input) {
      const todo = todos.get(todoId);
      if (!todo) throw new Error(`todo not found: ${todoId}`);
      const now = Date.now();
      const task: Task = {
        id: crypto.randomUUID(),
        todoId,
        title: input.title,
        description: input.description ?? "",
        status: "pending",
        workdir: input.workdir,
        ...(input.baseBranch ? { baseBranch: input.baseBranch } : {}),
        ...(input.worktreeEnabled === false ? { worktreeEnabled: false } : {}),
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(task.id, task);
      persistTasks(todoId);
      // 创建第一个 task → todo 进行中
      if (todo.status === "pending") {
        todo.status = "in_progress";
        touch(todo);
        persistTodos();
      }
      return { ...task };
    },

    getTask(id) {
      const task = tasks.get(id);
      return task ? { ...task } : undefined;
    },

    listTasks(todoId) {
      return [...tasks.values()]
        .filter((t) => t.todoId === todoId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((t) => ({ ...t }));
    },

    updateTask(id, patch) {
      const task = tasks.get(id);
      if (!task || task.status !== "pending") return undefined;
      if (patch.title !== undefined) task.title = patch.title;
      if (patch.description !== undefined) task.description = patch.description;
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      return { ...task };
    },

    updateTaskStatus(id, status) {
      const task = tasks.get(id);
      if (!task) return undefined;
      task.status = status;
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      return { ...task };
    },

    setTaskWorktree(id, info) {
      const task = tasks.get(id);
      if (!task) return undefined;
      task.worktreeName = info.name;
      task.worktreeRepoRoot = info.repoRoot;
      // workdir 同步为最终工作目录（worktree 路径）：agent 实际干活的地方
      if (info.workdir) task.workdir = info.workdir;
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      return { ...task };
    },

    addComment(taskId, input) {
      return addCommentInternal(taskId, input);
    },

    listComments(taskId) {
      const task = tasks.get(taskId);
      if (!task) return [];
      return (comments.get(taskId) ?? []).map((c) => ({ ...c }));
    },

    createRun(taskId, input) {
      return createRunInternal(taskId, input);
    },

    listRuns(taskId) {
      const task = tasks.get(taskId);
      if (!task) return [];
      return (runs.get(taskId) ?? []).map((r) => ({ ...r }));
    },

    updateRunStatus(id, status) {
      return updateRunStatusInternal(id, status);
    },

    getTaskByExecutionSession(sessionId) {
      for (const task of tasks.values()) {
        if (task.executionSessionId === sessionId) return { ...task };
      }
      return undefined;
    },

    enqueueTask(taskId) {
      const task = tasks.get(taskId);
      if (!task || task.status !== "pending") return undefined;
      if (latestActiveRun(taskId)) return undefined;
      const run = createRunInternal(taskId, { status: "queued" });
      return run;
    },

    markRunning(taskId, executionSessionId) {
      const task = tasks.get(taskId);
      if (!task || task.status !== "pending") return undefined;
      const run = latestActiveRun(taskId);
      if (!run || run.status !== "queued") return undefined;
      updateRunStatusInternal(run.id, "running");
      // 执行记录留 sessionId（Session.id），供审核通过后排查会话
      run.sessionId = executionSessionId;
      const list = runs.get(taskId) ?? [];
      runs.set(taskId, list.map((r) => (r.id === run.id ? run : r)));
      persistRuns(task.todoId);
      task.status = "running";
      task.executionSessionId = executionSessionId;
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      return { ...task };
    },

    setRunSessionIds(taskId, ids) {
      const task = tasks.get(taskId);
      if (!task) return undefined;
      const run = latestActiveRun(taskId);
      if (!run) return undefined;
      if (ids.sessionId !== undefined) run.sessionId = ids.sessionId;
      if (ids.agentSessionId !== undefined) run.agentSessionId = ids.agentSessionId;
      const list = runs.get(taskId) ?? [];
      runs.set(taskId, list.map((r) => (r.id === run.id ? run : r)));
      persistRuns(task.todoId);
      return { ...run };
    },

    completeRun(taskId, input = {}) {
      const task = tasks.get(taskId);
      if (!task || task.status !== "running") return undefined;
      const run = latestActiveRun(taskId);
      if (run) updateRunStatusInternal(run.id, "finished");
      task.status = "review";
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      const ok = input.ok ?? true;
      // 执行成功且有 AI 总结（执行会话最后文本块）→ 评论用 AI 原文；
      // 否则回退系统固定文案（含失败原因）
      const summary = ok ? input.summary?.trim() : undefined;
      const content = summary
        ? summary
        : ok
          ? "✅ 执行完成，等待审核。"
          : `⚠️ 执行中断/出错：${input.error ?? "未知错误"}`;
      addCommentInternal(taskId, {
        author: summary ? "ai" : "system",
        kind: "result",
        content,
      });
      return { ...task };
    },

    cancelTask(taskId) {
      const task = tasks.get(taskId);
      if (!task || task.status === "completed" || task.status === "cancelled") return undefined;
      const run = latestActiveRun(taskId);
      if (run) updateRunStatusInternal(run.id, "canceled");
      task.status = "cancelled";
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      return { ...task };
    },

    approveTask(taskId) {
      const task = tasks.get(taskId);
      if (!task || task.status === "completed" || task.status === "cancelled") return undefined;
      task.status = "completed";
      // 保留 worktreeName/worktreeRepoRoot（worktree 目录不删，供复核/排查）；
      // 清执行会话引用（会话已删），会话 id 已留在执行记录（run.sessionId/agentSessionId）。
      delete task.executionSessionId;
      task.updatedAt = Date.now();
      persistTasks(task.todoId);
      return { ...task };
    },
  };
}
