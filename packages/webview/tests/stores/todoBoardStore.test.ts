import { beforeEach, describe, expect, it, vi } from "vitest";
import { MuseApiClient } from "../../src/muse/apiClient.js";
import { useTodoBoardStore } from "../../src/stores/todoBoardStore.js";

function apiWith(handlers: Record<string, () => Promise<unknown>>): MuseApiClient {
  return new MuseApiClient({
    baseUrl: "http://x",
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      const h = handlers[`${method} ${url.replace("http://x", "")}`];
      if (!h) return new Response(JSON.stringify({ error: "nf" }), { status: 404 });
      return new Response(JSON.stringify(await h()), { status: 200 });
    },
  });
}

describe("todoBoardStore", () => {
  beforeEach(() => {
    useTodoBoardStore.setState({
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
    });
  });

  it("load sorts todos by priority and selects first", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          { id: "a", title: "A", priority: "p2", source: "session", status: "pending", createdAt: 1, updatedAt: 1, description: "" },
          { id: "b", title: "B", priority: "p0", source: "session", status: "pending", createdAt: 2, updatedAt: 2, description: "" },
        ],
      }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
    });
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() => expect(useTodoBoardStore.getState().todos.length).toBe(2));
    const s = useTodoBoardStore.getState();
    expect(s.todos.map((t) => t.id)).toEqual(["b", "a"]);
    expect(s.selectedTodoId).toBe("b");
    expect(s.loading).toBe(false);
  });

  it("init 相同 api 再次调用（看板重挂载）重新拉取数据", async () => {
    let calls = 0;
    const api = apiWith({
      "GET /todos": async () => {
        calls++;
        // 第一次挂载时无 todo；切走创建后重挂载返回新 todo
        return {
          todos:
            calls === 1
              ? []
              : [{ id: "t1", title: "T", priority: "p1", source: "session", status: "pending", createdAt: 1, updatedAt: 1, description: "" }],
        };
      },
      "GET /todos/t1/tasks": async () => ({ tasks: [] }),
    });
    // 第一次挂载
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() => expect(calls).toBe(1));
    // 模拟 TodoBoard 卸载后重挂载（同 api 引用）
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() => expect(useTodoBoardStore.getState().todos.length).toBe(1));
    expect(calls).toBe(2);
    expect(useTodoBoardStore.getState().todos[0]?.title).toBe("T");
  });

  it("selectTodo refreshes that todo's tasks", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "GET /todos/x/tasks": async () => ({
        tasks: [{ id: "k1", todoId: "x", title: "K", status: "pending", workdir: "/p", createdAt: 1, updatedAt: 1, description: "" }],
      }),
    });
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() => expect(useTodoBoardStore.getState().loading).toBe(false));
    useTodoBoardStore.getState().selectTodo("x");
    await vi.waitFor(() => expect(useTodoBoardStore.getState().tasksByTodo["x"]?.[0]?.title).toBe("K"));
  });

  it("createTodo appends and sorts", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "POST /todos": async () => ({
        todo: { id: "n1", title: "N", priority: "p0", source: "manual", status: "pending", createdAt: 9, updatedAt: 9, description: "" },
      }),
    });
    useTodoBoardStore.getState().init(api);
    await Promise.resolve();
    await useTodoBoardStore.getState().createTodo({ title: "N", source: "manual", priority: "p0" });
    expect(useTodoBoardStore.getState().todos[0]?.title).toBe("N");
  });

  it("openNewTodo/closeNewTodo toggle flag", () => {
    useTodoBoardStore.getState().openNewTodo();
    expect(useTodoBoardStore.getState().newTodoOpen).toBe(true);
    useTodoBoardStore.getState().closeNewTodo();
    expect(useTodoBoardStore.getState().newTodoOpen).toBe(false);
  });

  it("selectTask loads comments and runs for the task", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "GET /tasks/k1/comments": async () => ({
        comments: [{ id: "c1", taskId: "k1", author: "user", kind: "note", content: "看看", createdAt: 1 }],
      }),
      "GET /tasks/k1/runs": async () => ({
        runs: [{ id: "r1", taskId: "k1", status: "finished", createdAt: 1, finishedAt: 2 }],
      }),
    });
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() => expect(useTodoBoardStore.getState().loading).toBe(false));
    useTodoBoardStore.getState().selectTask("k1");
    await vi.waitFor(() =>
      expect(useTodoBoardStore.getState().commentsByTask["k1"]?.[0]?.content).toBe("看看"),
    );
    expect(useTodoBoardStore.getState().runsByTask["k1"]?.[0]?.status).toBe("finished");
  });

  it("addComment appends user comment to the thread", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "POST /tasks/k1/comments": async () => ({
        comment: { id: "c2", taskId: "k1", author: "user", kind: "note", content: "通过", createdAt: 2 },
      }),
    });
    useTodoBoardStore.getState().init(api);
    await Promise.resolve();
    const ok = await useTodoBoardStore.getState().addComment("k1", "通过");
    expect(ok).toBe(true);
    expect(useTodoBoardStore.getState().commentsByTask["k1"]?.[0]?.content).toBe("通过");
    // 空白内容不发送
    expect(await useTodoBoardStore.getState().addComment("k1", "   ")).toBe(false);
  });

  it("updateTask patches the task in its todo's list", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "PATCH /tasks/k1": async () => ({
        task: {
          id: "k1", todoId: "x", title: "改名", description: "", status: "pending",
          workdir: "/p", createdAt: 1, updatedAt: 2,
        },
      }),
    });
    useTodoBoardStore.getState().init(api);
    await Promise.resolve();
    useTodoBoardStore.setState({
      tasksByTodo: { x: [{ id: "k1", todoId: "x", title: "旧", description: "", status: "pending", workdir: "/p", createdAt: 1, updatedAt: 1 }] },
    });
    const task = await useTodoBoardStore.getState().updateTask("k1", { title: "改名" });
    expect(task?.title).toBe("改名");
    expect(useTodoBoardStore.getState().tasksByTodo["x"]?.[0]?.title).toBe("改名");
  });

  it("handleNotify pushes notification and bumps reviewCount; dismiss removes", () => {
    useTodoBoardStore.setState({ reviewCount: 0, notifications: [] });
    useTodoBoardStore.getState().handleNotify({
      todoId: "t1",
      taskId: "k1",
      todoTitle: "修复竞态",
      taskTitle: "实现 aborted 标记",
      priority: "p0",
    });
    const s = useTodoBoardStore.getState();
    expect(s.notifications.length).toBe(1);
    expect(s.notifications[0].todoTitle).toBe("修复竞态");
    expect(s.reviewCount).toBe(1);
    useTodoBoardStore.getState().dismissNotification(s.notifications[0].id);
    expect(useTodoBoardStore.getState().notifications.length).toBe(0);
  });

  it("handleNotify refreshes the todo's tasks so the board updates automatically", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "GET /todos/t1/tasks": async () => ({
        tasks: [
          { id: "k1", todoId: "t1", title: "K", description: "", status: "review", workdir: "/p", createdAt: 1, updatedAt: 2 },
        ],
      }),
    });
    useTodoBoardStore.getState().init(api);
    await Promise.resolve();
    // 执行完成通知 → 对应 todo 的看板数据被拉取更新
    useTodoBoardStore.getState().handleNotify({
      todoId: "t1",
      taskId: "k1",
      todoTitle: "修复竞态",
      taskTitle: "实现 aborted 标记",
      priority: "p0",
    });
    await vi.waitFor(() =>
      expect(useTodoBoardStore.getState().tasksByTodo["t1"]?.[0]?.status).toBe("review"),
    );
    // reviewCount 由重算兜底（本地 +1 与刷新重算一致）
    expect(useTodoBoardStore.getState().reviewCount).toBe(1);
  });

  it("recomputeReviewCount counts 待审核 tasks across todos", () => {
    useTodoBoardStore.setState({
      tasksByTodo: {
        t1: [
          { id: "a", todoId: "t1", title: "a", description: "", status: "review", workdir: "/p", createdAt: 1, updatedAt: 1 },
          { id: "b", todoId: "t1", title: "b", description: "", status: "completed", workdir: "/p", createdAt: 2, updatedAt: 2 },
        ],
        t2: [
          { id: "c", todoId: "t2", title: "c", description: "", status: "review", workdir: "/p", createdAt: 3, updatedAt: 3 },
        ],
      },
    });
    useTodoBoardStore.getState().recomputeReviewCount();
    expect(useTodoBoardStore.getState().reviewCount).toBe(2);
  });

  it("approveTask POSTs /tasks/:id/approve and refreshes", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [] }),
      "POST /tasks/k1/approve": async () => ({ ok: true }),
      "GET /todos/x/tasks": async () => ({
        tasks: [{ id: "k1", todoId: "x", title: "K", description: "", status: "completed", workdir: "/p", createdAt: 1, updatedAt: 2 }],
      }),
    });
    useTodoBoardStore.getState().init(api);
    await Promise.resolve();
    useTodoBoardStore.setState({
      tasksByTodo: { x: [{ id: "k1", todoId: "x", title: "K", description: "", status: "review", workdir: "/p", createdAt: 1, updatedAt: 1 }] },
    });
    const ok = await useTodoBoardStore.getState().approveTask("k1");
    expect(ok).toBe(true);
    await vi.waitFor(() =>
      expect(useTodoBoardStore.getState().tasksByTodo["x"]?.[0]?.status).toBe("completed"),
    );
  });

  it("completeTodo POSTs /todos/:id/complete and removes from list", async () => {
    let todoCalls = 0;
    const api = apiWith({
      "GET /todos": async () => {
        todoCalls++;
        return {
          todos: [
            { id: "t1", title: "T", priority: "p1", source: "session", status: "in_progress", createdAt: 1, updatedAt: 2, description: "" },
          ],
        };
      },
      "POST /todos/t1/complete": async () => ({ ok: true }),
      "GET /todos/t1/tasks": async () => ({ tasks: [] }),
    });
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() =>
      expect(useTodoBoardStore.getState().todos[0]?.status).toBe("in_progress"),
    );

    const ok = await useTodoBoardStore.getState().completeTodo("t1");
    expect(ok).toBe(true);
    expect(useTodoBoardStore.getState().todos).toEqual([]);
    expect(todoCalls).toBe(1); // 完成不触发重拉 todo 列表
  });

  it("completeTodo returns false when server rejects (409 unfinished tasks)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          { id: "t1", title: "T", priority: "p1", source: "session", status: "in_progress", createdAt: 1, updatedAt: 2, description: "" },
        ],
      }),
      "POST /todos/t1/complete": async () => {
        throw new Error("Muse API 409: todo has unfinished tasks");
      },
      "GET /todos/t1/tasks": async () => ({ tasks: [] }),
    });
    useTodoBoardStore.getState().init(api);
    await vi.waitFor(() =>
      expect(useTodoBoardStore.getState().todos[0]?.status).toBe("in_progress"),
    );

    const ok = await useTodoBoardStore.getState().completeTodo("t1");
    expect(ok).toBe(false);
    expect(useTodoBoardStore.getState().todos).toHaveLength(1);
  });
});
