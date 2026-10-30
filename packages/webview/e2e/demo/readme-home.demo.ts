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
    "今天想让我帮你做些什么？",
  );
  await expect(webviewPage.getByTestId("new-session-page")).toHaveCount(0);
  await expect(webviewPage.locator(".assistant-error")).toHaveCount(0);

  await webviewPage.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.body.classList.add("vscode-dark");
    document.body.classList.remove("vscode-light");
  });

  await screenshotWebp(
    webviewPage,
    "../../docs/public/screenshots/desktop-muse-bot.webp",
  );
});
