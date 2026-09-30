import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { screenshotWebp } from "../utils/screenshot.js";

const DIR_A = "/Users/dev/projects/muse-work";
const TASK_DIR = "/Users/dev/.muse-work/projects/task-payment-refactor";

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

test.describe("Desktop session tree actions", () => {
  test("pin rename and workdir context menu", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 720 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      workdir: DIR_A,
      session: {
        id: "sess-workspace-1",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: "2026-07-27T10:12:00Z",
        lastActiveAt: "2026-07-27T10:12:00Z",
        firstMessage: "修登录页样式",
      },
    });

    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "pin",
          sessions: [
            {
              sessionId: "sess-pinned-1",
              title: "长期跟进：支付重构",
              lastActiveAt: new Date("2026-07-27T11:00:00Z").getTime(),
              workdir: DIR_A,
              hasWorktree: false,
              pinned: true,
            },
          ],
        },
        {
          host: "local",
          workdir: "recent",
          sessions: [
            {
              sessionId: "sess-workspace-1",
              title: "修登录页样式",
              lastActiveAt: new Date("2026-07-27T10:12:00Z").getTime(),
              workdir: DIR_A,
              hasWorktree: false,
            },
            {
              sessionId: "sess-task-1",
              title: "后台任务：扫依赖漏洞",
              lastActiveAt: new Date("2026-07-26T09:00:00Z").getTime(),
              workdir: TASK_DIR,
              hasWorktree: false,
            },
          ],
        },
      ],
    });

    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-pinned-1"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-task-1"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-session-item-sess-workspace-1"),
    ).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-session-tree-sections.webp",
    );

    // Hover to reveal pin, then click — host receives desktopTogglePinSession
    const workspaceItem = webviewPage.getByTestId(
      "desktop-session-item-sess-workspace-1",
    );
    await workspaceItem.hover();
    await webviewPage
      .getByTestId("desktop-session-pin-sess-workspace-1")
      .click();
    await injector.waitForMessage("desktopTogglePinSession");

    // Double-click title to rename
    await workspaceItem.locator(".desktop-session-title").dblclick();
    const titleInput = webviewPage.getByTestId(
      "desktop-session-title-input-sess-workspace-1",
    );
    await expect(titleInput).toBeVisible();
    await titleInput.fill("登录页样式修复（重命名）");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-session-rename.webp",
    );
    await titleInput.press("Enter");
    await injector.waitForMessage("desktopRenameSession");

    // Right-click workdir row → open in editor / terminal
    await webviewPage
      .getByTestId(`desktop-session-workdir-row-${DIR_A}`)
      .click({ button: "right" });
    await expect(
      webviewPage.getByTestId("desktop-workdir-context-menu"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-workdir-open-in-editor"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("desktop-workdir-open-in-terminal"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-workdir-context-menu.webp",
    );

    await webviewPage.getByTestId("desktop-workdir-open-in-editor").click();
    await injector.waitForMessage("desktopOpenInEditor");
  });
});
