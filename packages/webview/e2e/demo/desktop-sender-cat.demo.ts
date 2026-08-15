import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { screenshotWebp, elementScreenshotWebp } from "../utils/screenshot.js";

/**
 * Draft new-session page with the decorative sender cat.
 * Captures a full desktop viewport + a tight crop around the composer.
 */
test.describe("Desktop New Session Sender Cat", () => {
  test("capture sender cat on new-session page", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      recentWorkdirs: [],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
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
      session: {
        id: "__draft__",
        sessionType: "main",
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });

    await expect(webviewPage.getByTestId("new-session-page")).toBeVisible();
    await expect(
      webviewPage.getByTestId("new-session-sender-cat"),
    ).toBeVisible();
    await expect(webviewPage.getByText("Hi~ 欢迎使用 Muse")).toBeVisible();

    // Match typical desktop dark chrome for the review screenshot.
    await webviewPage.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
      document.body.classList.add("vscode-dark");
      document.body.classList.remove("vscode-light");
    });

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-new-session-cat.webp",
    );

    await elementScreenshotWebp(
      webviewPage.getByTestId("new-session-page-composer"),
      "../../docs/public/screenshots/desktop-new-session-cat-composer.webp",
    );
  });
});
