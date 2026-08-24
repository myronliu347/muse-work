import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  MuseApiClient,
  MuseComment,
  MuseRun,
  MuseTask,
  MuseTodo,
  MuseTodoPriority,
  MuseTodoSource,
} from "../muse/apiClient";

export interface NewTodoInput {
  title: string;
  description?: string;
  priority?: MuseTodoPriority;
  source: MuseTodoSource;
  tags?: string[];
}

/** task 进待审核的通知（server WS todo:notify）。 */
export interface TodoNotification {
  id: string;
  todoId: string;
  taskId: string;
  todoTitle: string;
  taskTitle: string;
  priority: string;
  createdAt: number;
}

interface TodoBoardState {
  api: MuseApiClient | null;
  todos: MuseTodo[];
  tasksByTodo: Record<string, MuseTask[]>;
  selectedTodoId: string | null;
  selectedTaskId: string | null;
  commentsByTask: Record<string, MuseComment[]>;
  runsByTask: Record<string, MuseRun[]>;
  loading: boolean;
  error: string | null;
  newTodoOpen: boolean;
  notifications: TodoNotification[];
  /** 全部 todo 的待审核 task 计数（侧栏 badge）。 */
  reviewCount: number;
  /** 看板是否按选中 todo 筛选（默认 false=展示全部 todo 的 task）。 */
  filterByTodo: boolean;

  init(api: MuseApiClient): void;
  load(): Promise<void>;
  refreshTasks(todoId: string): Promise<void>;
  setFilterByTodo(v: boolean): void;
  selectTodo(id: string): void;
  createTodo(input: NewTodoInput): Promise<MuseTodo | null>;
  updateTodo(id: string, patch: Partial<Pick<MuseTodo, "title" | "description" | "priority" | "tags">>): Promise<MuseTodo | null>;
  /** 取消 todo（级联取消未完成任务）：从列表移除 + 选中回退。 */
  cancelTodo(id: string): Promise<boolean>;
  /** 手动标记 todo 已完成（有任务未到终态时服务端 409）：成功从列表移除。 */
  completeTodo(id: string): Promise<boolean>;
  openNewTodo(): void;
  closeNewTodo(): void;
  selectTask(id: string): void;
  closeTaskDrawer(): void;
  loadComments(taskId: string): Promise<void>;
  loadRuns(taskId: string): Promise<void>;
  addComment(taskId: string, content: string): Promise<boolean>;
  updateTask(id: string, patch: Partial<Pick<MuseTask, "title" | "description">>): Promise<MuseTask | null>;
  /** 开始执行/继续执行：入队（立即调度）。 */
  enqueueTask(taskId: string): Promise<boolean>;
  /** 取消 task（执行中则中止会话）。 */
  cancelTask(taskId: string): Promise<boolean>;
  /** 审核通过（仅待审核）。 */
  approveTask(taskId: string): Promise<boolean>;
  /** WS todo:notify 事件入口（task 进待审核）。 */
  handleNotify(payload: { todoId: string; taskId: string; todoTitle: string; taskTitle: string; priority: string }): void;
  dismissNotification(id: string): void;
  /** 重算所有 todo 的待审核 task 计数（load/refresh 后调用）。 */
  recomputeReviewCount(): void;
}

function sortTodos(list: MuseTodo[]): MuseTodo[] {
  const order: MuseTodoPriority[] = ["p0", "p1", "p2"];
  return [...list].sort(
    (a, b) =>
      order.indexOf(a.priority) - order.indexOf(b.priority) ||
      a.createdAt - b.createdAt,
  );
}

export const useTodoBoardStore = create<TodoBoardState>((set, get) => ({
  api: null,
  todos: [],
  tasksByTodo: {},
  selectedTodoId: null,
  selectedTaskId: null,
  commentsByTask: {},
  runsByTask: {},
  loading: true,
  error: null,
  newTodoOpen: false,
  notifications: [],
  reviewCount: 0,
  filterByTodo: false,

  init(api) {
    set({ api });
    void get().load();
  },

  async load() {
    const api = get().api;
    if (!api) return;
    try {
      const { todos } = await api.listTodos();
      const sorted = sortTodos(todos);
      set({
        todos: sorted,
        error: null,
        loading: false,
        selectedTodoId:
          get().selectedTodoId && sorted.some((t) => t.id === get().selectedTodoId)
            ? get().selectedTodoId
            : sorted[0]?.id ?? null,
      });
      // 看板默认展示全部 todo 的 task → 拉取所有 todo 的 tasks
      await Promise.all(
        sorted.map((t) =>
          api
            .listTasks(t.id)
            .then(({ tasks }) => {
              set((s) => ({ tasksByTodo: { ...s.tasksByTodo, [t.id]: tasks } }));
            })
            .catch(() => {
              // 单个 todo 拉取失败不阻塞看板
            }),
        ),
      );
      get().recomputeReviewCount();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  async refreshTasks(todoId) {
    const api = get().api;
    if (!api) return;
    try {
      const { tasks } = await api.listTasks(todoId);
      set((s) => ({ tasksByTodo: { ...s.tasksByTodo, [todoId]: tasks } }));
      get().recomputeReviewCount();
    } catch {
      // 静默：看板渲染不因单个 task 拉取失败崩溃
    }
  },

  setFilterByTodo(v) {
    set({ filterByTodo: v });
  },

  recomputeReviewCount() {
    const count = Object.values(get().tasksByTodo)
      .flat()
      .filter((t) => t.status === "review").length;
    set({ reviewCount: count });
  },

  selectTodo(id) {
    set({ selectedTodoId: id });
    if (id) void get().refreshTasks(id);
  },

  async createTodo(input) {
    const api = get().api;
    if (!api) return null;
    try {
      const { todo } = await api.createTodo(input);
      set((s) => ({ todos: sortTodos([...s.todos, todo]) }));
      return todo;
    } catch {
      return null;
    }
  },

  async updateTodo(id, patch) {
    const api = get().api;
    if (!api) return null;
    try {
      const { todo } = await api.updateTodo(id, patch);
      set((s) => ({
        todos: sortTodos(s.todos.map((t) => (t.id === todo.id ? todo : t))),
      }));
      return todo;
    } catch {
      return null;
    }
  },

  async cancelTodo(id) {
    const api = get().api;
    if (!api) return false;
    try {
      await api.cancelTodo(id);
      set((s) => {
        const remaining = s.todos.filter((t) => t.id !== id);
        const selectedTodoId =
          s.selectedTodoId === id ? (remaining[0]?.id ?? null) : s.selectedTodoId;
        return { todos: remaining, selectedTodoId };
      });
      return true;
    } catch {
      return false;
    }
  },

  async completeTodo(id) {
    const api = get().api;
    if (!api) return false;
    try {
      await api.completeTodo(id);
      set((s) => {
        const remaining = s.todos.filter((t) => t.id !== id);
        const selectedTodoId =
          s.selectedTodoId === id ? (remaining[0]?.id ?? null) : s.selectedTodoId;
        return { todos: remaining, selectedTodoId };
      });
      return true;
    } catch {
      return false;
    }
  },

  openNewTodo() {
    set({ newTodoOpen: true });
  },

  closeNewTodo() {
    set({ newTodoOpen: false });
  },

  selectTask(id) {
    set({ selectedTaskId: id });
    if (id) {
      void get().loadComments(id);
      void get().loadRuns(id);
    }
  },

  closeTaskDrawer() {
    set({ selectedTaskId: null });
  },

  async loadComments(taskId) {
    const api = get().api;
    if (!api) return;
    try {
      const { comments } = await api.listComments(taskId);
      set((s) => ({ commentsByTask: { ...s.commentsByTask, [taskId]: comments } }));
    } catch {
      // 静默
    }
  },

  async loadRuns(taskId) {
    const api = get().api;
    if (!api) return;
    try {
      const { runs } = await api.listRuns(taskId);
      set((s) => ({ runsByTask: { ...s.runsByTask, [taskId]: runs } }));
    } catch {
      // 静默
    }
  },

  async addComment(taskId, content) {
    const api = get().api;
    if (!api || !content.trim()) return false;
    try {
      const { comment } = await api.addComment(taskId, {
        author: "user",
        kind: "note",
        content: content.trim(),
      });
      set((s) => ({
        commentsByTask: {
          ...s.commentsByTask,
          [taskId]: [...(s.commentsByTask[taskId] ?? []), comment],
        },
      }));
      return true;
    } catch {
      return false;
    }
  },

  async updateTask(id, patch) {
    const api = get().api;
    if (!api) return null;
    try {
      const { task } = await api.updateTask(id, patch);
      set((s) => ({
        tasksByTodo: {
          ...s.tasksByTodo,
          [task.todoId]: (s.tasksByTodo[task.todoId] ?? []).map((t) =>
            t.id === task.id ? task : t,
          ),
        },
      }));
      return task;
    } catch {
      return null;
    }
  },

  async enqueueTask(taskId) {
    const api = get().api;
    if (!api) return false;
    try {
      await api.enqueueTask(taskId);
      const task = Object.values(get().tasksByTodo).flat().find((t) => t.id === taskId);
      if (task) void get().refreshTasks(task.todoId);
      return true;
    } catch {
      return false;
    }
  },

  async cancelTask(taskId) {
    const api = get().api;
    if (!api) return false;
    try {
      await api.cancelTask(taskId);
      const task = Object.values(get().tasksByTodo).flat().find((t) => t.id === taskId);
      if (task) void get().refreshTasks(task.todoId);
      return true;
    } catch {
      return false;
    }
  },

  async approveTask(taskId) {
    const api = get().api;
    if (!api) return false;
    try {
      await api.approveTask(taskId);
      const task = Object.values(get().tasksByTodo).flat().find((t) => t.id === taskId);
      if (task) void get().refreshTasks(task.todoId);
      return true;
    } catch {
      return false;
    }
  },

  handleNotify(payload) {
    const notification: TodoNotification = {
      id: `${payload.taskId}-${Date.now()}`,
      todoId: payload.todoId,
      taskId: payload.taskId,
      todoTitle: payload.todoTitle,
      taskTitle: payload.taskTitle,
      priority: payload.priority,
      createdAt: Date.now(),
    };
    set((s) => ({
      notifications: [...s.notifications, notification].slice(-5),
      // 待审核 +1（本地增量，refreshTasks 会重算兜底）
      reviewCount: s.reviewCount + 1,
    }));
    // 执行完成 → 立即刷新该 todo 的看板数据（不刷新页面停在旧状态）
    void get().refreshTasks(payload.todoId);
  },

  dismissNotification(id) {
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
    }));
  },
}));

/** 选中 todo 的派生数据（useShallow 浅比较，返回对象仅在字段变化时触发重渲染） */
export function useSelectedTodo(): MuseTodo | null {
  return useTodoBoardStore(
    useShallow((s) => {
      if (!s.selectedTodoId) return null;
      return s.todos.find((t) => t.id === s.selectedTodoId) ?? null;
    }),
  );
}

/** 看板 task 列表：filterByTodo 开 → 选中 todo 的 task；关 → 全部 todo 的 task 汇总。 */
export function useBoardTasks(): MuseTask[] {
  return useTodoBoardStore(
    useShallow((s) => {
      if (s.filterByTodo) {
        if (!s.selectedTodoId) return [];
        return s.tasksByTodo[s.selectedTodoId] ?? [];
      }
      return Object.values(s.tasksByTodo).flat();
    }),
  );
}

/** 选中 task（详情抽屉） */
export function useSelectedTask(): MuseTask | null {
  return useTodoBoardStore(
    useShallow((s) => {
      if (!s.selectedTaskId) return null;
      for (const tasks of Object.values(s.tasksByTodo)) {
        const found = tasks.find((t) => t.id === s.selectedTaskId);
        if (found) return found;
      }
      return null;
    }),
  );
}

/** 选中 task 的评论列表 */
export function useSelectedComments(): MuseComment[] {
  return useTodoBoardStore(
    useShallow((s) => {
      if (!s.selectedTaskId) return [];
      return s.commentsByTask[s.selectedTaskId] ?? [];
    }),
  );
}

/** 选中 task 的执行记录 */
export function useSelectedRuns(): MuseRun[] {
  return useTodoBoardStore(
    useShallow((s) => {
      if (!s.selectedTaskId) return [];
      return s.runsByTask[s.selectedTaskId] ?? [];
    }),
  );
}
