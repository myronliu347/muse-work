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

    await webviewPage.setViewportSize({ width: 1280, height: 800 });

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
    await expect(webviewPage.getByTestId("welcome-headline")).toBeVisible();

    const wallpaper = webviewPage.getByTestId("new-session-wallpaper");
    await expect(wallpaper).toBeVisible();
    const cover = await wallpaper.evaluate((el) => {
      const style = getComputedStyle(el);
      const parent = el.parentElement;
      if (!parent) return null;
      const box = el.getBoundingClientRect();
      const frame = parent.getBoundingClientRect();
      return {
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
        parentOverflow: getComputedStyle(parent).overflow,
        bleedsX: box.width > frame.width + 8,
        bleedsY: box.height > frame.height + 8,
      };
    });
    expect(cover?.backgroundSize).toBe("cover");
    expect(cover?.backgroundPosition).toBe("50% 50%");
    expect(cover?.parentOverflow).toBe("hidden");
    expect(cover?.bleedsX).toBe(true);
    expect(cover?.bleedsY).toBe(true);

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
