import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { screenshotWebp } from "../utils/screenshot.js";

/** README hero: Muse Bot home with the icon rail. */
test("capture Muse Bot home", async ({ webviewPage }) => {
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
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4.1",
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
  await injector.simulateExtensionMessage("configuredModels", {
    models: ["gpt-4.1"],
    currentModel: "gpt-4.1",
  });

  await expect(webviewPage.getByTestId("desktop-assistant-menu")).toHaveClass(
    /active/,
  );
  await expect(webviewPage.getByTestId("welcome-headline")).toContainText(
    "今天想让我帮你办点什么？",
  );
  await expect(webviewPage.getByTestId("new-session-page")).toHaveCount(0);
  await expect(webviewPage.locator(".assistant-error")).toHaveCount(0);

  await webviewPage.evaluate(() => {
    document.body.classList.add("vscode-dark");
    document.body.classList.remove("vscode-light");
    window.postMessage(
      { command: "desktopThemeChange", effective: "dark" },
      "*",
    );
  });
  await expect(webviewPage.locator("html")).toHaveAttribute("data-theme", "dark");
  // Newer Chromium serializes composite colors as `color(srgb r g b)` with
  // 0..1 channels, so accept both forms; dark means all channels under ~80.
  await webviewPage.waitForFunction(() => {
    const layout = document.querySelector(".desktop-layout");
    if (!layout) return false;
    const bg = getComputedStyle(layout).backgroundColor;
    const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) {
      return Number(rgb[1]) < 80 && Number(rgb[2]) < 80 && Number(rgb[3]) < 80;
    }
    const srgb = bg.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (!srgb) return false;
    return [1, 2, 3].every((i) => Number(srgb[i]) < 0.32);
  });

  // Leave the composer unfocused so the screenshot has no focus ring.
  await webviewPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await webviewPage.waitForTimeout(300);

  await screenshotWebp(
    webviewPage,
    "../../docs/public/screenshots/desktop-muse-bot.webp",
  );
});
