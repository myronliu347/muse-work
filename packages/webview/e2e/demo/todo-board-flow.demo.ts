import { test, expect } from "../utils/desktopTestHarness.js";
import { screenshotWebp } from "../utils/screenshot.js";

// Todo/Task 看板全流程交互 demo（2026-08-21）：
// 新建 TODO（含标签）→ 行内操作收缩（chat + more）→ 搜索/标签筛选 →
// more 菜单编辑（PATCH）→ 打开规划会话（跳聊天视图）→ 打开执行会话 →
// more 取消 TODO（confirm → POST cancel → 行消失）。
// 所有 todo REST 走 page.route mock（pass-through 绕过 hostBridge，直连真实 URL）。

const todo = (over: Record<string, unknown>) => ({
  id: "todo-1",
  title: "修复支付链路竞态",
  description: "支付确认回调与超时重试存在竞态。",
  priority: "p0",
  source: "session",
  status: "in_progress",
  tags: [],
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
  ...over,
});

const task = (over: Record<string, unknown>) => ({
  id: "task-1",
  todoId: "todo-1",
  title: "实现 aborted 标记",
  description: "改 **hostBridge**",
  status: "review",
  workdir: "/Users/dev/projects/wave-agent",
  worktreeName: "worktree-fix-abort",
  executionSessionId: "sess-exec-1",
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
  ...over,
});

test.describe("Todo Board Full Flow Demo", () => {
  test("new → edit → search/filter → planning/exec session → cancel", async ({
    webviewPage,
  }) => {
    const requests: Array<{ method: string; url: string }> = [];
    const record = (route: import("@playwright/test").Route) => {
      requests.push({ method: route.request().method(), url: route.request().url() });
    };

    // 初始列表：todo-1（in_progress，带标签）+ todo-2（pending，无标签）
    await webviewPage.route("**/todos", async (route) => {
      if (route.request().method() !== "GET") {
        record(route);
        const body = JSON.parse((route.request().postData() ?? "{}") || "{}");
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              todo: todo({
                id: "todo-new",
                title: body.title ?? "",
                tags: body.tags ?? [],
                priority: "p1",
                status: "pending",
              }),
            }),
          });
          return;
        }
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          todos: [
            todo({ id: "todo-1", title: "修复支付链路竞态", tags: ["urgent", "支付"] }),
            todo({ id: "todo-2", title: "整理 README", priority: "p2", status: "pending", tags: [] }),
          ],
        }),
      });
    });

    // 编辑：PATCH /todos/:id（后注册，先于 **/todos 匹配）
    await webviewPage.route("**/todos/*", async (route) => {
      if (route.request().method() === "PATCH") {
        record(route);
        const body = JSON.parse((route.request().postData() ?? "{}") || "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            todo: todo({
              id: "todo-2",
              title: body.title ?? "整理 README",
              tags: body.tags ?? [],
              priority: "p2",
              status: "pending",
            }),
          }),
        });
        return;
      }
      await route.continue();
    });

    await webviewPage.route("**/todos/*/tasks", async (route) => {
      record(route);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks: [
            task({ id: "task-1", title: "实现 aborted 标记", status: "review" }),
            task({ id: "task-2", title: "补迟到 delta 测试", status: "pending", executionSessionId: undefined }),
          ],
        }),
      });
    });

    await webviewPage.route("**/tasks/*/comments", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          comments: [
            { id: "c-1", taskId: "task-1", author: "ai", kind: "result", content: "已完成 aborted 标记修复：hostBridge 增加 aborted 守卫，两击停止场景补了 3 个回归测试，全部通过。", createdAt: 1750000000000 },
          ],
        }),
      });
    });

    await webviewPage.route("**/tasks/*/runs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          runs: [
            { id: "r-1", taskId: "task-1", status: "finished", createdAt: 1750000000000, startedAt: 1750000000000, finishedAt: 1750000000000 },
          ],
        }),
      });
    });

    await webviewPage.route("**/todos/*/planning-session", async (route) => {
      record(route);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "sess-plan-1", workdir: "/tmp/proj" }),
      });
    });

    await webviewPage.route("**/todos/*/cancel", async (route) => {
      record(route);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    // confirm 弹窗自动接受（取消 todo 需要）
    webviewPage.on("dialog", (d) => void d.accept());

    // 打开任务看板
    await webviewPage.getByTestId("desktop-todo-board").click();
    await expect(webviewPage.getByText("修复支付链路竞态").first()).toBeVisible();
    await expect(webviewPage.getByTestId("todo-tag-chip-urgent")).toHaveText("urgent");
    await screenshotWebp(webviewPage, "../../docs/public/screenshots/todo-board-flow-1-list.webp");

    // 1) 新建 TODO：表单 + 标签
    await webviewPage.getByTestId("todo-new-btn").click();
    await webviewPage.getByTestId("todo-new-title").fill("补发版回归用例");
    await webviewPage.getByTestId("todo-edit-tags-input").fill("回归, urgent");
    await webviewPage.getByTestId("todo-edit-tags-add").click();
    await webviewPage.getByTestId("todo-new-save").click();
    await expect(webviewPage.getByText("补发版回归用例").first()).toBeVisible();
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/todos"))).toBe(true);

    // 2) 行内只保留 chat + more（无散落图标）
    const moreBtn = webviewPage.getByTestId("todo-more-todo-new");
    await expect(moreBtn).toBeVisible();
    await expect(webviewPage.locator(".todo-row .codicon-pencil")).toHaveCount(0);

    // 3) 搜索标题过滤
    await webviewPage.getByTestId("todo-search").fill("README");
    await expect(webviewPage.getByText("整理 README").first()).toBeVisible();
    await expect(webviewPage.getByText("修复支付链路竞态").first()).toBeHidden();
    await webviewPage.getByTestId("todo-search").fill("");

    // 4) 标签筛选（点 chip → 只显示带该标签的 todo）
    await webviewPage.getByTestId("todo-tag-chip-支付").click();
    await expect(webviewPage.getByText("修复支付链路竞态").first()).toBeVisible();
    await expect(webviewPage.getByText("整理 README").first()).toBeHidden();
    await webviewPage.getByTestId("todo-tag-chip-支付").click();

    // 5) more → 编辑 TODO（改标题 + PATCH；编辑仅待执行 todo 显示）
    await webviewPage.getByTestId("todo-more-todo-2").click();
    await webviewPage.getByTestId("todo-menu-edit-todo-2").click();
    const titleInput = webviewPage.getByTestId("todo-edit-title");
    await titleInput.fill("整理 README（改）");
    await webviewPage.getByTestId("todo-edit-save").click();
    await expect(webviewPage.getByText("整理 README（改）").first()).toBeVisible();
    expect(requests.some((r) => r.method === "PATCH" && r.url.includes("/todos/todo-2"))).toBe(true);
    await screenshotWebp(webviewPage, "../../docs/public/screenshots/todo-board-flow-2-edited.webp");

    // 6) 打开规划会话 → 跳聊天视图
    await webviewPage.getByTestId("todo-open-planning-todo-1").click();
    await expect(webviewPage.locator('[data-testid="chat-container"], .chat-container').first()).toBeVisible({ timeout: 5000 });
    expect(requests.some((r) => r.url.includes("/planning-session"))).toBe(true);
    await screenshotWebp(webviewPage, "../../docs/public/screenshots/todo-board-flow-3-planning.webp");

    // 7) 回看板 → 打开执行会话（task 有 executionSessionId）
    await webviewPage.getByTestId("desktop-todo-board").click();
    await expect(webviewPage.getByText("实现 aborted 标记").first()).toBeVisible();
    await webviewPage.getByTestId("todo-open-exec-session-task-1").click();
    await expect(webviewPage.locator('[data-testid="chat-container"], .chat-container').first()).toBeVisible({ timeout: 5000 });
    await screenshotWebp(webviewPage, "../../docs/public/screenshots/todo-board-flow-4-exec.webp");

    // 8) 回看板 → more 取消 TODO（confirm → POST cancel → 行消失）
    await webviewPage.getByTestId("desktop-todo-board").click();
    await expect(webviewPage.getByText("整理 README（改）").first()).toBeVisible();
    await webviewPage.getByTestId("todo-more-todo-1").click();
    await webviewPage.getByTestId("todo-menu-cancel-todo-1").click();
    await expect(webviewPage.getByText("修复支付链路竞态")).toHaveCount(0);
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/todos/todo-1/cancel"))).toBe(true);
    await screenshotWebp(webviewPage, "../../docs/public/screenshots/todo-board-flow-5-cancelled.webp");
  });
});
