import { test, expect } from "../utils/desktopTestHarness.js";
import { screenshotWebp } from "../utils/screenshot.js";

// Todo/Task 看板全流程 demo（spec 2026-08-21 原型定稿 A）：
// 左栏 todo 列表（优先级排序 + 状态徽标 + 来源）→ 右栏 4 状态看板 →
// 点击卡片打开详情抽屉（执行环境/操作按钮/执行记录/审核讨论）。

const todo = (over: Record<string, unknown>) => ({
  id: "todo-1",
  title: "修复支付链路竞态",
  description: "支付确认回调与超时重试存在竞态，需梳理状态机。",
  priority: "p0",
  source: "session",
  status: "in_progress",
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
  ...over,
});

const task = (over: Record<string, unknown>) => ({
  id: "task-1",
  todoId: "todo-1",
  title: "实现 aborted 标记",
  description: "改 **hostBridge**，修复两击停止",
  status: "review",
  workdir: "/Users/dev/projects/wave-agent",
  worktreeName: "worktree-fix-abort",
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
  ...over,
});

test.describe("Todo Board Demo", () => {
  test("capture todo board screenshots", async ({ webviewPage }) => {
    // Mock todo REST APIs（e2e pass-through 绕过 hostBridge，直连真实 URL）
    await webviewPage.route("**/todos", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          todos: [
            todo({ id: "todo-1", title: "修复支付链路竞态", priority: "p0" }),
            todo({ id: "todo-2", title: "补充 POPO 机器人错误重试", priority: "p1" }),
            todo({ id: "todo-3", title: "整理 README 文档", priority: "p2", status: "pending" }),
          ],
        }),
      });
    });

    await webviewPage.route("**/todos/*/tasks", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tasks: [
            task({ id: "task-1", title: "实现 aborted 标记", status: "review" }),
            task({ id: "task-2", title: "补迟到 delta 测试", status: "pending", worktreeName: undefined }),
            task({ id: "task-3", title: "加发版前回归用例", status: "running", worktreeName: "worktree-regression" }),
            task({ id: "task-4", title: "验收通过", status: "completed", worktreeName: undefined }),
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
            {
              id: "c-1",
              taskId: "task-1",
              author: "ai",
              kind: "result",
              content: "✅ 执行完成，等待审核。",
              createdAt: 1750000000000,
            },
            {
              id: "c-2",
              taskId: "task-1",
              author: "ai",
              kind: "note",
              content: "【AI 复核】实现覆盖了主路径，但迟到 delta 场景缺少断言，建议补充后再通过。",
              createdAt: 1750000000000,
            },
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
            {
              id: "r-1",
              taskId: "task-1",
              status: "finished",
              createdAt: 1750000000000,
              startedAt: 1750000000000,
              finishedAt: 1750000000000,
            },
          ],
        }),
      });
    });

    // 打开任务看板视图
    await webviewPage.getByTestId("desktop-todo-board").click();
    await expect(webviewPage.getByTestId("desktop-todo-board")).toBeVisible();
    await expect(webviewPage.getByText("修复支付链路竞态").first()).toBeVisible();
    await expect(webviewPage.getByText("实现 aborted 标记").first()).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/todo-board.webp",
    );

    // 点击卡片打开详情抽屉（执行环境/操作/执行记录/审核讨论）
    await webviewPage.getByText("实现 aborted 标记").first().click();
    await expect(webviewPage.getByTestId("todo-drawer")).toBeVisible();
    await expect(webviewPage.getByText(/worktree: worktree-fix-abort/)).toBeVisible();
    await expect(webviewPage.getByText(/AI · 执行结果/)).toBeVisible();
    await expect(webviewPage.getByText(/AI 复核/)).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/todo-board-drawer.webp",
    );
  });
});
