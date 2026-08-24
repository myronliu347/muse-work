import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MuseApiClient } from "../../src/muse/apiClient.js";
import { TodoBoard } from "../../src/components/todo/TodoBoard.js";
import { useTodoBoardStore } from "../../src/stores/todoBoardStore.js";
import { MuseTheme } from "../../src/ui/theme";

function renderBoard(
  api: MuseApiClient,
  overrides: {
    onOpenExecutionSession?: (sessionId: string) => void;
    onOpenInEditor?: (workdir: string) => void;
    onOpenInTerminal?: (workdir: string) => void;
    onTodosChanged?: () => void;
    pickDirectory?: () => Promise<string | null>;
  } = {},
) {
  return render(
    <MuseTheme>
      <TodoBoard
        api={api}
        onOpenExecutionSession={overrides.onOpenExecutionSession}
        onOpenInEditor={overrides.onOpenInEditor}
        onOpenInTerminal={overrides.onOpenInTerminal}
        onTodosChanged={overrides.onTodosChanged}
        pickDirectory={overrides.pickDirectory}
      />
    </MuseTheme>,
  );
}

function apiWith(
  handlers: Record<string, () => Promise<unknown>>,
  fetches?: Array<{ method: string; url: string; body?: string }>,
): MuseApiClient {
  const client = new MuseApiClient({
    baseUrl: "http://x",
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      const key = `${method} ${url.replace("http://x", "")}`;
      if (fetches) fetches.push({ method, url, body: init?.body as string });
      const h = handlers[key];
      if (!h) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      const body = await h();
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
  return client;
}

const todoFixture = (over: Record<string, unknown>) => ({
  id: "t1",
  title: "修复竞态",
  description: "",
  priority: "p1",
  source: "session",
  status: "pending",
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const taskFixture = (over: Record<string, unknown>) => ({
  id: "k1",
  todoId: "t1",
  title: "实现 aborted 标记",
  description: "改 **hostBridge**",
  status: "review",
  workdir: "/tmp/proj",
  worktreeName: "worktree-fix",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("TodoBoard", () => {
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
      filterByTodo: false,
      archivedMode: false,
    });
  });

  it("lists todos sorted by priority", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          todoFixture({ id: "a", title: "A", priority: "p2" }),
          todoFixture({ id: "b", title: "B", priority: "p0" }),
          todoFixture({ id: "c", title: "C", priority: "p1" }),
        ],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
      "GET /todos/c/tasks": async () => ({ tasks: [] }),
    });
    renderBoard(api);
    await waitFor(() => {
      const titles = screen.getAllByText(/^(A|B|C)$/).map((n) => n.textContent);
      expect(titles).toEqual(["B", "C", "A"]);
    });
  });

  it("excludes archived (已完成/已取消) todos — server filters, board renders what API returns", async () => {
    // Server already filters; board renders given list as-is (no archive row visible).
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    // 列表里没有归档 todo 行（「已完成」tab 是视图切换，不算）
    expect(screen.queryByText("已完成B")).toBeNull();
  });

  it("todo 行展示描述（有描述才显示，单行省略）", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          todoFixture({ id: "a", title: "A", description: "要做的目标说明" }),
          todoFixture({ id: "b", title: "B", description: "" }),
        ],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("要做的目标说明")).toBeTruthy());
    // 无描述的 todo 不显示描述行
    expect(screen.getByText("B").closest(".todo-row")?.querySelector(".todo-row-desc")).toBeNull();
  });

  it("shows empty-state guidance when no tasks at all (default 全部模式)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("还没有任何任务")).toBeTruthy());
  });

  it("开启「按 TODO 筛选」后无任务 todo 显示引导空状态", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByTestId("todo-filter-by-todo")).toBeTruthy());
    await user.click(screen.getByTestId("todo-filter-by-todo"));
    await waitFor(() => expect(screen.getByText("这个 TODO 还没有任务")).toBeTruthy());
  });

  it("renders kanban columns with task cards (md desc, worktree)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({})],
      }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    // 状态列徽标（列头 + 卡片徽标可能出现多次）
    expect(screen.getAllByText("待审核").length).toBeGreaterThan(0);
    expect(screen.getAllByText("待执行").length).toBeGreaterThan(0);
    // worktree
    expect(screen.getByText("worktree-fix")).toBeTruthy();
    // markdown 描述渲染为 <strong>
    expect(document.querySelector(".todo-task-card-desc strong")?.textContent).toBe("hostBridge");
  });

  it("todo 行打开规划按钮用存在的 codicon", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    // 打开规划会话：图标必须是 css 里真实存在的 codicon 类（codicon-chat 不存在导致空白）
    const plan = screen.getByTestId("todo-open-planning-a");
    expect(plan.querySelector(".codicon-comment-discussion")).toBeTruthy();
  });

  it("switches kanban when selecting another todo (筛选模式)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [todoFixture({ id: "a", title: "A" }), todoFixture({ id: "b", title: "B" })],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({
        tasks: [taskFixture({ id: "k2", todoId: "b", title: "B 的任务" })],
      }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    await user.click(screen.getByTestId("todo-filter-by-todo"));
    await waitFor(() => expect(screen.getByText("仅「当前 TODO」")).toBeTruthy());
    await user.click(screen.getByText("B"));
    await waitFor(() => expect(screen.getByText("B 的任务")).toBeTruthy());
  });

  it("默认全部模式：展示所有 todo 的 task，卡片标注所属 todo", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [todoFixture({ id: "a", title: "A" }), todoFixture({ id: "b", title: "B" })],
      }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k1", todoId: "a", title: "A 的任务" })],
      }),
      "GET /todos/b/tasks": async () => ({
        tasks: [taskFixture({ id: "k2", todoId: "b", title: "B 的任务" })],
      }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A 的任务")).toBeTruthy());
    // 两个 todo 的 task 都在看板（无需点击切换）
    expect(screen.getByText("B 的任务")).toBeTruthy();
    // 卡片标注所属 todo（长标题单行省略 + title 属性可看全）
    const tagA = screen.getByTestId("todo-task-todo-k1");
    expect(tagA.querySelector(".todo-task-todo-title")?.textContent).toBe("A");
    expect(tagA.getAttribute("title")).toBe("A");
  });

  it("opens task drawer with 执行环境/执行记录/审核讨论", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [taskFixture({})] }),
      "GET /tasks/k1/comments": async () => ({
        comments: [
          {
            id: "c1",
            taskId: "k1",
            author: "ai",
            kind: "result",
            content: "**覆盖了主路径**",
            createdAt: 0,
          },
        ],
      }),
      "GET /tasks/k1/runs": async () => ({
        runs: [{ id: "r1", taskId: "k1", status: "finished", createdAt: 0, startedAt: 0, finishedAt: 0 }],
      }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getByText("实现 aborted 标记"));
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    expect(screen.getAllByText(/worktree-fix/).length).toBeGreaterThan(0);
    expect(screen.getByText(/执行完成/)).toBeTruthy();
    expect(screen.getByText(/AI · 执行结果/)).toBeTruthy();
    expect(document.querySelector(".todo-thread strong")?.textContent).toBe("覆盖了主路径");
  });

  it("renders status actions by task state (待审核→通过/继续执行/取消)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [taskFixture({})] }),
      "GET /tasks/k1/comments": async () => ({ comments: [] }),
      "GET /tasks/k1/runs": async () => ({ runs: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getByText("实现 aborted 标记"));
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    expect(document.querySelector(".codicon-check")).toBeTruthy();
    expect(document.querySelector(".codicon-refresh")).toBeTruthy();
    expect(document.querySelector(".codicon-close")).toBeTruthy();
  });

  it("待执行 task drawer shows 开始执行 and 编辑; non-待执行 hides 编辑", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k2", status: "pending" })],
      }),
      "GET /tasks/k2/comments": async () => ({ comments: [] }),
      "GET /tasks/k2/runs": async () => ({ runs: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    expect(document.querySelector(".codicon-play")).toBeTruthy();
    expect(document.querySelector(".codicon-pencil")).toBeTruthy();
  });

  it("comment composer submits via 发送 and ⌘+Enter", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
        "GET /todos/a/tasks": async () => ({ tasks: [taskFixture({})] }),
        "GET /tasks/k1/comments": async () => ({ comments: [] }),
        "GET /tasks/k1/runs": async () => ({ runs: [] }),
        "POST /tasks/k1/comments": async () => ({
          comment: { id: "c2", taskId: "k1", author: "user", kind: "note", content: "echo", createdAt: 1 },
        }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    const input = screen.getByTestId("todo-comment-input");
    await user.type(input, "再审一次");
    await user.click(screen.getByTestId("todo-comment-send"));
    await waitFor(() =>
      expect(fetches.filter((f) => f.url.endsWith("/tasks/k1/comments") && f.method === "POST")).toHaveLength(1),
    );
    expect(JSON.parse(fetches[fetches.length - 1].body ?? "{}").content).toBe("再审一次");
    // ⌘+Enter 提交第二条
    await user.type(input, "再看一遍");
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() =>
      expect(fetches.filter((f) => f.url.endsWith("/tasks/k1/comments") && f.method === "POST")).toHaveLength(2),
    );
    expect(JSON.parse(fetches[fetches.length - 1].body ?? "{}").content).toBe("再看一遍");
    expect((screen.getByTestId("todo-comment-input") as HTMLTextAreaElement).value).toBe("");
  });

  it("todo row edit only for 待执行; saves via PATCH (edit lives in the more menu)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          todoFixture({ id: "a", title: "A" }),
          todoFixture({ id: "b", title: "B", status: "in_progress" }),
        ],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
      "PATCH /todos/a": async () => ({
        todo: todoFixture({ id: "a", title: "A 改了", priority: "p0" }),
      }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    // 进行中 todo 无编辑入口（more 菜单里也没有）
    await user.click(screen.getByTestId("todo-more-b"));
    expect(await screen.findByTestId("todo-menu-cancel-b")).toBeTruthy();
    expect(screen.queryByTestId("todo-menu-edit-b")).toBeNull();
    await user.keyboard("{Escape}");

    // 待执行 A 的 more 菜单有编辑项
    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-edit-a"));
    const titleInput = screen.getByTestId("todo-edit-title") as HTMLInputElement;
    await user.clear(titleInput);
    await user.type(titleInput, "A 改了");
    await user.click(screen.getByTestId("todo-edit-save"));
    await waitFor(() => expect(screen.getByText("A 改了")).toBeTruthy());
  });

  it("drawer 开始执行 enqueues task (T4 接线)", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
        "GET /todos/a/tasks": async () => ({
          tasks: [taskFixture({ id: "k2", status: "pending" })],
        }),
        "GET /tasks/k2/comments": async () => ({ comments: [] }),
        "GET /tasks/k2/runs": async () => ({ runs: [] }),
        "POST /tasks/k2/enqueue": async () => ({ ok: true }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    await user.click(document.querySelector(".codicon-play") as Element);
    await waitFor(() =>
      expect(fetches.some((f) => f.url.endsWith("/tasks/k2/enqueue"))).toBe(true),
    );
    // 开始执行成功后抽屉自动收起
    await waitFor(() => expect(screen.queryByTestId("todo-drawer")).toBeNull());
  });

  it("drawer 取消执行中 task POSTs cancel (T4 接线)", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
        "GET /todos/a/tasks": async () => ({
          tasks: [taskFixture({ id: "k2", status: "running" })],
        }),
        "GET /tasks/k2/comments": async () => ({ comments: [] }),
        "GET /tasks/k2/runs": async () => ({ runs: [] }),
        "POST /tasks/k2/cancel": async () => ({ ok: true }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    const closes = document.querySelectorAll(".codicon-close");
    await user.click(closes[closes.length - 1] as Element);
    await waitFor(() =>
      expect(fetches.some((f) => f.url.endsWith("/tasks/k2/cancel"))).toBe(true),
    );
    // 取消成功后抽屉自动收起
    await waitFor(() => expect(screen.queryByTestId("todo-drawer")).toBeNull());
  });

  it("drawer 审核通过（review → completed）成功后自动收起", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    let taskCalls = 0;
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
        "GET /todos/a/tasks": async () => {
          taskCalls++;
          // 首次渲染 review；approve 后重拉 completed
          return {
            tasks: [taskFixture({ id: "k2", status: taskCalls > 1 ? "completed" : "review" })],
          };
        },
        "GET /tasks/k2/comments": async () => ({ comments: [] }),
        "GET /tasks/k2/runs": async () => ({ runs: [] }),
        "POST /tasks/k2/approve": async () => ({ ok: true }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    await user.click(document.querySelector(".codicon-check") as Element);
    await waitFor(() =>
      expect(fetches.some((f) => f.url.endsWith("/tasks/k2/approve"))).toBe(true),
    );
    // 审核通过成功后抽屉自动收起
    await waitFor(() => expect(screen.queryByTestId("todo-drawer")).toBeNull());
  });

  it("drawer 操作成功后回调 onTodosChanged（侧栏任务分组刷新）", async () => {
    const onTodosChanged = vi.fn();
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k2", status: "review" })],
      }),
      "GET /tasks/k2/comments": async () => ({ comments: [] }),
      "GET /tasks/k2/runs": async () => ({ runs: [] }),
      "POST /tasks/k2/approve": async () => ({ ok: true }),
      "POST /tasks/k2/cancel": async () => ({ ok: true }),
    });
    const user = userEvent.setup();
    renderBoard(api, { onTodosChanged });
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());

    // 审核通过 → 通知侧栏刷新
    await user.click(document.querySelector(".codicon-check") as Element);
    await waitFor(() => expect(onTodosChanged).toHaveBeenCalledTimes(1));
  });

  it("取消 todo（more 菜单）成功后回调 onTodosChanged", async () => {
    const onTodosChanged = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "POST /todos/a/cancel": async () => ({ ok: true }),
    });
    const user = userEvent.setup();
    renderBoard(api, { onTodosChanged });
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-cancel-a"));
    await waitFor(() => expect(onTodosChanged).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it("filters todo rows by title search (search box matches title only)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          todoFixture({ id: "a", title: "修复竞态" }),
          todoFixture({ id: "b", title: "写评审文档" }),
        ],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("修复竞态")).toBeTruthy());
    await user.type(screen.getByTestId("todo-search"), "评审");
    expect(screen.queryByText("修复竞态")).toBeNull();
    expect(screen.getByText("写评审文档")).toBeTruthy();
  });

  it("shows tag chips on todo rows; clicking a chip filters by that tag (click again to clear)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          todoFixture({ id: "a", title: "A", tags: ["urgent"] }),
          todoFixture({ id: "b", title: "B", tags: ["前端"] }),
          todoFixture({ id: "c", title: "C", tags: ["后端"] }),
        ],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
      "GET /todos/c/tasks": async () => ({ tasks: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    expect(screen.getByTestId("todo-tag-chip-urgent")).toHaveTextContent("urgent");

    await user.click(screen.getByTestId("todo-tag-chip-urgent"));
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.queryByText("C")).toBeNull();

    // 再点一次 chip 取消筛选，恢复全部
    await user.click(screen.getByTestId("todo-tag-chip-urgent"));
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
  });

  it("filters tags via the dropdown selector (multi-select OR)", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [
          todoFixture({ id: "a", title: "A", tags: ["urgent"] }),
          todoFixture({ id: "b", title: "B", tags: ["前端"] }),
          todoFixture({ id: "c", title: "C", tags: ["后端"] }),
        ],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos/b/tasks": async () => ({ tasks: [] }),
      "GET /todos/c/tasks": async () => ({ tasks: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-tag-filter"));
    await user.click(await screen.findByTestId("todo-tag-filter-option-urgent"));
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.queryByText("B")).toBeNull();

    // 下拉多选第二个标签 → OR：任一命中即显示 A、B
    await user.click(screen.getByTestId("todo-tag-filter"));
    await user.click(await screen.findByTestId("todo-tag-filter-option-前端"));
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.queryByText("C")).toBeNull();
  });

  it("edits todo tags from typed input and PATCHes them on save (via more menu)", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({
          todos: [todoFixture({ id: "a", title: "A", tags: ["urgent"] })],
        }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
        "PATCH /todos/a": async () => ({
          todo: todoFixture({ id: "a", title: "A", tags: ["urgent", "后端"] }),
        }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    // 编辑入口收进 more 菜单
    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-edit-a"));
    await user.type(screen.getByTestId("todo-edit-tags-input"), "后端");
    await user.click(screen.getByTestId("todo-edit-tags-add"));
    await user.click(screen.getByTestId("todo-edit-save"));

    await waitFor(() =>
      expect(
        fetches.some(
          (f) =>
            f.method === "PATCH" &&
            JSON.parse(f.body ?? "{}").tags?.includes("后端"),
        ),
      ).toBe(true),
    );
  });

  it("cancels a todo from the more menu (confirm → POST /todos/:id/cancel)", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = apiWith(
      {
        "GET /todos": async () => ({
          todos: [todoFixture({ id: "a", title: "A" })],
        }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
        "POST /todos/a/cancel": async () => ({ ok: true }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-cancel-a"));

    await waitFor(() =>
      expect(fetches.some((f) => f.url.endsWith("/todos/a/cancel"))).toBe(true),
    );
    // 取消后从列表移除
    expect(screen.queryByText("A")).toBeNull();
    confirmSpy.mockRestore();
  });

  it("marks a todo complete from the more menu (confirm → POST /todos/:id/complete → removed)", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = apiWith(
      {
        "GET /todos": async () => ({
          todos: [todoFixture({ id: "a", title: "A" })],
        }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
        "POST /todos/a/complete": async () => ({ ok: true }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-complete-a"));

    await waitFor(() =>
      expect(fetches.some((f) => f.url.endsWith("/todos/a/complete"))).toBe(true),
    );
    // 完成后从列表移除
    expect(screen.queryByText("A")).toBeNull();
    confirmSpy.mockRestore();
  });

  it("declines completing when confirm is dismissed (no POST)", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = apiWith(
      {
        "GET /todos": async () => ({
          todos: [todoFixture({ id: "a", title: "A" })],
        }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-complete-a"));

    // 确认取消 → 不发请求、不提示
    expect(fetches.some((f) => f.url.endsWith("/todos/a/complete"))).toBe(false);
    expect(screen.getByText("A")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it("alerts when server rejects completing (409 unfinished tasks)", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const api = apiWith(
      {
        "GET /todos": async () => ({
          todos: [todoFixture({ id: "a", title: "A" })],
        }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
        "POST /todos/a/complete": async () => {
          throw new Error("Muse API 409: todo has unfinished tasks");
        },
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-complete-a"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // 被拦截 → todo 保留在列表
    expect(screen.getByText("A")).toBeTruthy();
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("+ 新建 TODO opens the form and POSTs with title/tags/manual source", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [] }),
        "POST /todos": async () => ({
          todo: todoFixture({ id: "new1", title: "新 todo", tags: ["urgent"] }),
        }),
        "GET /todos/new1/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByTestId("todo-new-btn")).toBeTruthy());

    await user.click(screen.getByTestId("todo-new-btn"));
    await user.type(screen.getByTestId("todo-new-title"), "新 todo");
    await user.type(screen.getByTestId("todo-edit-tags-input"), "urgent");
    await user.click(screen.getByTestId("todo-edit-tags-add"));
    await user.click(screen.getByTestId("todo-new-save"));

    await waitFor(() =>
      expect(
        fetches.some((f) => {
          if (f.method !== "POST") return false;
          const body = JSON.parse(f.body ?? "{}");
          return (
            body.title === "新 todo" &&
            body.source === "manual" &&
            body.tags?.includes("urgent")
          );
        }),
      ).toBe(true),
    );
    // 创建成功后表单收起
    expect(screen.queryByTestId("todo-new-title")).toBeNull();
  });

  it("切换「已完成」视图：拉取已完成 todo，归档只读（隐藏新建/更多操作/详情操作）", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "进行中A" })] }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "GET /todos?archived=1": async () => ({
        todos: [todoFixture({ id: "d1", title: "已完成B", status: "completed" })],
      }),
      "GET /todos/d1/tasks": async () => ({
        tasks: [taskFixture({ id: "dk1", todoId: "d1", title: "已执行任务", status: "completed" })],
      }),
      "GET /tasks/dk1/comments": async () => ({
        comments: [{ id: "c1", taskId: "dk1", author: "ai", kind: "note", content: "【AI 复核】合理", createdAt: 1 }],
      }),
      "GET /tasks/dk1/runs": async () => ({ runs: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("进行中A")).toBeTruthy());
    // 进行中视图：新建按钮可见
    expect(screen.getByTestId("todo-new-btn")).toBeTruthy();

    await user.click(screen.getByTestId("todo-view-archived"));
    // 「已完成B」出现在左列 todo 行 + 看板卡片 todo 标签（多处）
    await waitFor(() =>
      expect(screen.getAllByText("已完成B").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("已执行任务")).toBeTruthy();
    // 归档只读：无新建按钮、无 more 菜单
    expect(screen.queryByTestId("todo-new-btn")).toBeNull();
    expect(screen.queryByTestId("todo-more-d1")).toBeNull();
    // 归档任务详情抽屉：无操作按钮、无评论输入
    await user.click(screen.getByText("已执行任务"));
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());
    expect(screen.queryByTestId("todo-comment-input")).toBeNull();
    expect(screen.queryByTestId(`todo-open-editor-dk1`)).toBeNull();

    // 切回进行中视图
    await user.click(screen.getByTestId("todo-view-active"));
    await waitFor(() => expect(screen.getByText("进行中A")).toBeTruthy());
    expect(screen.getByTestId("todo-new-btn")).toBeTruthy();
  });

  it("新建 TODO 弹窗：选择目录按钮调 pickDirectory 填入路径，创建 POST 带 workdir", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [] }),
        "POST /todos": async () => ({
          todo: todoFixture({ id: "new1", title: "绑目录", workdir: "/tmp/bound" }),
        }),
        "GET /todos/new1/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    const pickDirectory = vi.fn(async () => "/picked/repo");
    renderBoard(api, { pickDirectory });
    await waitFor(() => expect(screen.getByTestId("todo-new-btn")).toBeTruthy());

    await user.click(screen.getByTestId("todo-new-btn"));
    // workdir 行 + 选择按钮可见
    expect(screen.getByTestId("todo-new-workdir")).toBeTruthy();
    await user.click(screen.getByTestId("todo-new-pick-workdir"));
    expect(pickDirectory).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect((screen.getByTestId("todo-new-workdir") as HTMLInputElement).value).toBe(
        "/picked/repo",
      ),
    );
    await user.type(screen.getByTestId("todo-new-title"), "绑目录");
    await user.click(screen.getByTestId("todo-new-save"));

    await waitFor(() =>
      expect(
        fetches.some((f) => {
          if (f.method !== "POST") return false;
          const body = JSON.parse(f.body ?? "{}");
          return body.title === "绑目录" && body.workdir === "/picked/repo";
        }),
      ).toBe(true),
    );
  });

  it("新建 TODO 弹窗：清除按钮清空已选 workdir", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [] }),
        "POST /todos": async () => ({
          todo: todoFixture({ id: "new1", title: "不绑", workdir: "/picked/repo" }),
        }),
        "GET /todos/new1/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    const pickDirectory = vi.fn(async () => "/picked/repo");
    renderBoard(api, { pickDirectory });
    await waitFor(() => expect(screen.getByTestId("todo-new-btn")).toBeTruthy());

    await user.click(screen.getByTestId("todo-new-btn"));
    await user.click(screen.getByTestId("todo-new-pick-workdir"));
    await waitFor(() =>
      expect((screen.getByTestId("todo-new-workdir") as HTMLInputElement).value).toBe(
        "/picked/repo",
      ),
    );
    await user.click(screen.getByTestId("todo-new-clear-workdir"));
    await user.type(screen.getByTestId("todo-new-title"), "不绑");
    await user.click(screen.getByTestId("todo-new-save"));

    await waitFor(() =>
      expect(
        fetches.some((f) => {
          if (f.method !== "POST") return false;
          const body = JSON.parse(f.body ?? "{}");
          return body.title === "不绑" && body.workdir === undefined;
        }),
      ).toBe(true),
    );
  });

  it("编辑 TODO 弹窗不显示 workdir 行（绑定不可修改）", async () => {
    const api = apiWith({
      "GET /todos": async () => ({
        todos: [todoFixture({ id: "a", title: "已绑定", workdir: "/tmp/bound" })],
      }),
      "GET /todos/a/tasks": async () => ({ tasks: [] }),
      "PATCH /todos/a": async () => ({
        todo: todoFixture({ id: "a", title: "已绑定2", workdir: "/tmp/bound" }),
      }),
    });
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("已绑定")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(screen.getByTestId("todo-menu-edit-a"));
    expect(screen.queryByTestId("todo-edit-workdir")).toBeNull();
  });

  it("新建 TODO 弹窗：优先级 chip 单选 p0 后创建", async () => {
    const fetches: Array<{ method: string; url: string; body?: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [] }),
        "POST /todos": async () => ({
          todo: todoFixture({ id: "new1", title: "紧急", priority: "p0" }),
        }),
        "GET /todos/new1/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByTestId("todo-new-btn")).toBeTruthy());

    await user.click(screen.getByTestId("todo-new-btn"));
    await user.click(screen.getByTestId("todo-priority-p0"));
    await user.type(screen.getByTestId("todo-new-title"), "紧急");
    await user.click(screen.getByTestId("todo-new-save"));

    await waitFor(() =>
      expect(
        fetches.some((f) => {
          if (f.method !== "POST") return false;
          const body = JSON.parse(f.body ?? "{}");
          return body.title === "紧急" && body.priority === "p0";
        }),
      ).toBe(true),
    );
  });

  it("编辑 TODO 弹窗：Esc 关闭不保存", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-edit-a"));
    await user.type(screen.getByTestId("todo-edit-title"), "不应保存");
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("todo-dialog")).toBeNull();
    expect(fetches.some((f) => f.method === "PATCH")).toBe(false);
  });

  it("编辑 TODO 弹窗：点遮罩关闭不保存", async () => {
    const fetches: Array<{ method: string; url: string }> = [];
    const api = apiWith(
      {
        "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
        "GET /todos/a/tasks": async () => ({ tasks: [] }),
      },
      fetches,
    );
    const user = userEvent.setup();
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());

    await user.click(screen.getByTestId("todo-more-a"));
    await user.click(await screen.findByTestId("todo-menu-edit-a"));
    await user.type(screen.getByTestId("todo-edit-title"), "不应保存");
    await user.click(screen.getByTestId("todo-dialog"));

    expect(screen.queryByTestId("todo-dialog")).toBeNull();
    expect(fetches.some((f) => f.method === "PATCH")).toBe(false);
  });

  it("opens the execution session from the kanban card (has executionSessionId)", async () => {
    const onOpenExecutionSession = vi.fn();
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k1", status: "running", executionSessionId: "sess-exec" })],
      }),
    });
    const user = userEvent.setup();
    renderBoard(api, { onOpenExecutionSession });
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());

    await user.click(screen.getByTestId("todo-open-exec-session-k1"));
    expect(onOpenExecutionSession).toHaveBeenCalledWith("sess-exec");
  });

  it("disables open-exec-session when the task never ran", async () => {
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k1", status: "pending" })],
      }),
    });
    renderBoard(api);
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());

    const btn = screen.getByTestId("todo-open-exec-session-k1");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("aria-label")).toBe("尚未执行，无会话");
  });

  it("drawer 在编辑器中打开 workdir（workdir 即最终工作目录，含 worktree 场景）", async () => {
    const onOpenInEditor = vi.fn();
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k1", worktreeName: "worktree-fix" })],
      }),
      "GET /tasks/k1/comments": async () => ({ comments: [] }),
      "GET /tasks/k1/runs": async () => ({ runs: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api, { onOpenInEditor });
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());

    await user.click(screen.getByTestId("todo-open-editor-k1"));
    // workdir 语义=最终工作目录（server 建 worktree 后已同步为 worktree 路径）
    expect(onOpenInEditor).toHaveBeenCalledWith("/tmp/proj");
  });

  it("drawer 在终端中打开 workdir（非 worktree 用原目录）", async () => {
    const onOpenInTerminal = vi.fn();
    const api = apiWith({
      "GET /todos": async () => ({ todos: [todoFixture({ id: "a", title: "A" })] }),
      "GET /todos/a/tasks": async () => ({
        tasks: [taskFixture({ id: "k1", worktreeName: undefined })],
      }),
      "GET /tasks/k1/comments": async () => ({ comments: [] }),
      "GET /tasks/k1/runs": async () => ({ runs: [] }),
    });
    const user = userEvent.setup();
    renderBoard(api, { onOpenInTerminal });
    await waitFor(() => expect(screen.getByText("实现 aborted 标记")).toBeTruthy());
    await user.click(screen.getAllByText("实现 aborted 标记")[0]);
    await waitFor(() => expect(screen.getByTestId("todo-drawer")).toBeTruthy());

    await user.click(screen.getByTestId("todo-open-terminal-k1"));
    expect(onOpenInTerminal).toHaveBeenCalledWith("/tmp/proj");
  });
});
