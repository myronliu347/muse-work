import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp } from "../utils/screenshot.js";

const DIR_A = "/Users/dev/projects/muse-work";

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

test.describe("Desktop git context and worktree create", () => {
  test("bound session shows branch and worktree badges", async ({
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
      session: {
        id: "sess-wt-1",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: "2026-07-27T10:12:00Z",
        lastActiveAt: "2026-07-27T10:12:00Z",
        firstMessage: "在隔离 worktree 里改登录",
        worktreeName: "login-fix",
        worktreeBranch: "worktree-login-fix",
      },
    });
    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "在隔离 worktree 里改登录",
        "msg-u1",
      ),
      MockDataGenerator.createAssistantMessage(
        "已在 worktree `login-fix` 中改动了 LoginForm。",
        "msg-a1",
      ),
    ]);

    // Bound session with messages → DesktopGitContext in the chat header
    const header = webviewPage.getByTestId("chat-header");
    await expect(header.getByTestId("desktop-git-context")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-git-branch")).toContainText(
      "worktree-login-fix",
    );
    await expect(webviewPage.getByTestId("desktop-git-worktree")).toContainText(
      "login-fix",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-git-context.webp",
    );
  });

  test("checking worktree then sending first message posts create", async ({
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
  });

  test("selecting a non-current branch then sending uses that baseBranch", async ({
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

    await webviewPage.getByTestId("desktop-branch-selector").click();
    await expect(webviewPage.getByTestId("desktop-branch-menu")).toBeVisible();
    await webviewPage
      .getByTestId("desktop-branch-item")
      .filter({ hasText: "develop" })
      .click();
    await expect(webviewPage.getByTestId("desktop-branch-selector")).toContainText(
      "develop",
    );

    await webviewPage.getByTestId("desktop-worktree-checkbox").click();
    await injector.clearMessageLog();

    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("从 develop 开 worktree");
    await webviewPage.keyboard.press("Enter");

    await injector.waitForMessage("desktopCreateWorktree");
    const sent = await injector.getMessagesSentToExtension();
    const create = sent.find((m) => m.command === "desktopCreateWorktree");
    expect(create).toMatchObject({
      command: "desktopCreateWorktree",
      baseBranch: "develop",
      workdir: DIR_A,
    });
    expect(create?.baseBranch).not.toBe("main");
  });
});
