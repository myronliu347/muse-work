import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

test.describe("worktree duplicate repro", () => {
  test("first message with worktree checked posts desktopCreateWorktree exactly once", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      workdir: DIR_A,
      isAuthenticated: true,
    });

    await injector.waitForMessage("desktopListGitBranches");
    await injector.simulateExtensionMessage("desktopGitBranches", {
      result: {
        branches: ["main", "develop"],
        current: "main",
      },
    });

    await expect(
      webviewPage.getByTestId("desktop-worktree-controls"),
    ).toBeVisible();
    await webviewPage.getByTestId("desktop-worktree-checkbox").click();
    await injector.clearMessageLog();

    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("在新 worktree 里重构支付模块");
    await webviewPage.keyboard.press("Enter");

    const createMsg = await injector.waitForMessage("desktopCreateWorktree");
    expect(createMsg).toBeTruthy();
    await injector.clearMessageLog();

    // Second message while the first worktree create is still in flight
    // (no appendMessage yet in pass-through mode) — must NOT trigger a second
    // desktopCreateWorktree, otherwise every create posts twice.
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("第二条消息");
    await webviewPage.keyboard.press("Enter");
    await webviewPage.waitForTimeout(500);

    const count = await webviewPage.evaluate(() => {
      const messages: Array<{ command?: string }> = window.getTestMessages();
      return messages.filter((m) => m.command === "desktopCreateWorktree")
        .length;
    });
    expect(count).toBe(0);
  });
});
