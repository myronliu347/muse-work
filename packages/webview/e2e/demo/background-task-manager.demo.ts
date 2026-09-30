import { test, expect } from "../utils/webviewTestHarness.js";
import { elementScreenshotWebp } from "../utils/screenshot.js";

test.describe("Background Task List Demo", () => {
  test("should show background tasks inline above the sender", async ({
    webviewPage,
  }) => {
    // Wider viewport so the inline card + input area are captured together
    await webviewPage.setViewportSize({ width: 800, height: 700 });

    // 0. Bind a session so the chat chrome (and the input-area list) renders
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "setInitialState",
        isAuthenticated: true,
        messages: [],
        sessions: [],
        workdir: "/mock/workdir",
        session: {
          id: "sess-demo",
          sessionType: "main",
          workdir: "/mock/workdir",
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 0,
        },
      });
    });

    // 1. Simulate extension pushing background tasks (real-time via WS)
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: "updateBackgroundTasks",
        tasks: [
          {
            id: "bt-1",
            type: "shell",
            status: "running",
            startTime: Date.now() - 45000,
            command: "npm run build",
            description: "构建 monorepo",
            runtime: 45000,
            outputPath: "/tmp/muse-task-bt-1.log",
          },
          {
            id: "bt-2",
            type: "subagent",
            status: "completed",
            startTime: Date.now() - 120000,
            endTime: Date.now() - 80000,
            description: "探索 packages/webview 结构",
            runtime: 40000,
            exitCode: 0,
            outputPath: "/tmp/muse-task-bt-2.log",
          },
          {
            id: "bt-3",
            type: "shell",
            status: "failed",
            startTime: Date.now() - 200000,
            endTime: Date.now() - 195000,
            command: "npm test",
            description: "运行测试套件",
            runtime: 5000,
            exitCode: 1,
            outputPath: "/tmp/muse-task-bt-3.log",
          },
        ],
      });
    });

    // Verify the inline list is visible above the sender
    await expect(
      webviewPage.getByTestId("background-task-list"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("background-task-list"),
    ).toContainText("后台任务 (3)");
    await expect(
      webviewPage.getByTestId("background-task-list"),
    ).toContainText("npm run build");

    // Screenshot the inline list
    const list = webviewPage.getByTestId("background-task-list");
    await elementScreenshotWebp(
      list,
      "../../docs/public/screenshots/spec-background-task-list.webp",
    );
  });
});
