import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp } from "../utils/screenshot.js";

const DIR_A = "/Users/dev/projects/wave-agent";

test.describe("Issue session chrome", () => {
  test("issue detail shows compact header, sender, and panel toggle", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 800 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: [],
      issueGroups: [
        {
          issueId: "issue-1",
          title: "修复登录校验测试",
          priority: "p1",
          status: "planning",
          items: [],
          agentMode: "single",
          planningSessionId: "plan-1",
          sessions: [
            {
              sessionId: "plan-1",
              title: "修复登录校验测试",
              workdir: DIR_A,
              hasWorktree: false,
              lastActiveAt: Date.now(),
            },
          ],
        },
      ],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      workdir: DIR_A,
      configurationData: {
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
      },
      permissionMode: "default",
      session: {
        id: "plan-1",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: "2026-07-27T10:12:00Z",
        lastActiveAt: "2026-07-27T10:12:00Z",
        firstMessage: "继续派发一个清单执行",
      },
    });
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("继续派发一个清单执行", "msg-u1"),
      MockDataGenerator.createAssistantMessage(
        "单 agent 会话无法 dispatch，请直接在规划里改代码。",
        "msg-a1",
      ),
    ]);

    await expect(webviewPage.getByTestId("issue-session-header")).toBeVisible();
    await expect(webviewPage.getByTestId("issue-session-title")).toHaveText(
      "修复登录校验测试",
    );
    await expect(webviewPage.getByTestId("panel-toggle-btn")).toBeVisible();
    await expect(webviewPage.getByTestId("chat-header")).toHaveCount(0);
    await expect(webviewPage.locator(".input-content")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-issue-session-chrome.webp",
    );
  });
});
