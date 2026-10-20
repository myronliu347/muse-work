import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp, elementScreenshotWebp } from "../utils/screenshot.js";
import { mockMuseSettingsApis } from "../utils/museApiMock.js";

const DIR_A = "/Users/dev/projects/muse-work";
const DIR_B = "/Users/dev/projects/shop-server";
const DIR_C = "/Users/dev/projects/notes-app";

const session = (
  id: string,
  workdir: string,
  firstMessage: string,
  lastActiveAt: string,
) => ({
  id,
  sessionType: "main",
  workdir,
  createdAt: lastActiveAt,
  lastActiveAt,
  latestTotalTokens: 12000,
  firstMessage,
});

// A session tree entry. Sidebar sections are pin / 任务 / 工作空间; workspace
// sessions are grouped by their `workdir` field. Green running / orange waiting
// dots come from the tree entry flags.
const treeSession = (
  sessionId: string,
  title: string,
  lastActiveAt: string,
  workdir: string,
  running = false,
  waitingConfirmation = false,
) => ({
  sessionId,
  title,
  lastActiveAt: new Date(lastActiveAt).getTime(),
  workdir,
  hasWorktree: false,
  running,
  waitingConfirmation,
});

const treeGroups = [
  { host: "local", workdir: "pin", sessions: [] },
  {
    host: "local",
    workdir: "recent",
    sessions: [
      treeSession(
        "sess-a1",
        "帮我修复登录页的样式问题",
        "2026-07-27T10:12:00Z",
        DIR_A,
        true,
      ),
      treeSession(
        "sess-a2",
        "给 bashTool 增加超时参数",
        "2026-07-26T09:40:00Z",
        DIR_A,
        false,
        true,
      ),
      treeSession(
        "sess-a3",
        "解释一下 listSessions 的实现",
        "2026-07-25T15:02:00Z",
        DIR_A,
      ),
      treeSession(
        "sess-a4",
        "重构会话索引的持久化层",
        "2026-07-25T11:30:00Z",
        DIR_A,
      ),
      treeSession(
        "sess-a5",
        "补全桌面端分屏的测试用例",
        "2026-07-24T18:05:00Z",
        DIR_A,
      ),
      treeSession(
        "sess-a6",
        "修复终端面板首次聚焦丢失",
        "2026-07-24T14:20:00Z",
        DIR_A,
      ),
      treeSession(
        "sess-a7",
        "梳理 worktree 隔离会话的边界",
        "2026-07-23T09:10:00Z",
        DIR_A,
      ),
      treeSession(
        "sess-b1",
        "订单接口偶发 500 排查",
        "2026-07-27T08:30:00Z",
        DIR_B,
      ),
      treeSession(
        "sess-b2",
        "给购物车加单元测试",
        "2026-07-24T11:20:00Z",
        DIR_B,
      ),
      treeSession(
        "sess-c1",
        "支持 Markdown 导出",
        "2026-07-23T14:00:00Z",
        DIR_C,
      ),
    ],
  },
];

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

test.describe("Desktop App Screenshots", () => {
  test("capture desktop-specific features", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 960, height: 640 });

    // ── 1. First launch: no workdir selected ─────────────────────
    // Sidebar renders the session tree with all directory groups
    // expanded by default; the input area (including +/slash/permission/
    // send buttons) is disabled until the user picks a directory.
    // Recents must be EMPTY here: effectiveWorkdir falls back to
    // recentWorkdirs[0] when state.workdir is unset (ChatApp.tsx), so the
    // "no workdir" placeholder only renders when there is no recents list.
    // desktopWorkdirState mounts ChatApp; wait for its message listener
    // (webviewReady) before setInitialState, otherwise the payload is lost to
    // the mount race and the empty-messages body renders the LoadingLogo
    // sweep instead of the welcome page.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      recentWorkdirs: [],
    });
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: treeGroups,
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-workdir")).toContainText(
      "选择工作目录…",
    );
    // Regression guard: the empty-messages body must render the welcome
    // page, not the LoadingLogo sweep. The sweep appeared before because
    // setInitialState was dispatched before ChatApp's listener attached.
    await expect(webviewPage.locator(".loading-logo")).toHaveCount(0);
    await expect(webviewPage.getByTestId("welcome-headline")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-brand")).toBeVisible();
    await elementScreenshotWebp(
      webviewPage.getByTestId("desktop-sidebar-footer"),
      "../../docs/public/screenshots/desktop-sidebar-brand.webp",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-first-launch.webp",
    );

    // ── 2. Session tree: workdir selected, all groups expanded ────
    // The active session shows a green running dot; a session awaiting a
    // confirmation shows an orange waiting dot. Every directory lists all
    // of its sessions (no 5-per-directory cap), newest-first.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      session: session(
        "sess-a1",
        DIR_A,
        "帮我修复登录页的样式问题",
        "2026-07-27T10:12:00Z",
      ),
    });

    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-a1"),
    ).toBeVisible();
    await expect(
      webviewPage
        .getByTestId("desktop-session-item-sess-a1")
        .locator("[data-testid='desktop-session-status-running']"),
    ).toBeVisible();
    await expect(
      webviewPage
        .getByTestId("desktop-session-item-sess-a2")
        .locator("[data-testid='desktop-session-status-waiting']"),
    ).toBeVisible();
    // Other groups are expanded by default too
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-b1"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-session-tree.webp",
    );

    // ── 3. Workdir dropdown in the input area ─────────────────────
    await webviewPage.getByTestId("desktop-workdir").click();
    await expect(webviewPage.getByTestId("desktop-workdir-menu")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-workdir-dropdown.webp",
    );
    await webviewPage.keyboard.press("Escape");

    // ── 4. Core chat interaction ───────────────────────────────────
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
      MockDataGenerator.createAssistantMessage(
        "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
        "msg-a1",
      ),
    ]);
    // Note: the workdir selector in the input only renders for a fresh
    // session (no messages yet) — by design (ChatApp.tsx).
    await expect(webviewPage.locator(".message.user")).toBeVisible();
    await expect(webviewPage.locator(".message.assistant")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-chat.webp",
    );
  });

  test("worktree-isolated new-session page shows branch selector", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 960, height: 640 });

    // Single-pane (no desktopPanes) → ChatApp renders the new-session page
    // once a workdir is chosen. It then asks the host for the repo's branches
    // (desktopListGitBranches); the demo replies so the controls render.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
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
        branches: ["main", "feature/login", "develop"],
        current: "main",
      },
    });

    await expect(
      webviewPage.getByTestId("desktop-worktree-controls"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-worktree-checkbox"),
    ).toBeVisible();

    // Open the branch selector dropdown.
    await webviewPage.getByTestId("desktop-branch-selector").click();
    await expect(webviewPage.getByTestId("desktop-branch-menu")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-branch-item")).toHaveCount(3);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-worktree-controls.webp",
    );
  });

  test("sidebar settings button opens config dialog", async ({ webviewPage }) => {
    await mockMuseSettingsApis(webviewPage);
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      isAuthenticated: true,
    });

    await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
    await webviewPage.getByTestId("desktop-settings-btn").click();
    await expect(webviewPage.getByTestId("config-dialog")).toBeVisible();
    await expect(webviewPage.getByTestId("appearance-settings")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-dialog.webp",
    );

    // Provider tab (CodeMaker quota)
    await webviewPage.getByRole("tab", { name: "供应商" }).click();
    await expect(webviewPage.getByTestId("muse-provider-settings")).toBeVisible();
    await expect(webviewPage.getByTestId("muse-codemaker-quota")).toBeVisible();
    await expect(webviewPage.getByTestId("muse-quota-progress")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-provider.webp",
    );
  });
});
