import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { screenshotWebp } from "../utils/screenshot.js";

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

test.describe("Desktop automations empty state", () => {
  test("empty automations page is a centered create prompt", async ({
    webviewPage,
  }) => {
    test.setTimeout(20_000);
    await webviewPage.route("**/automations", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ automations: [] }),
      });
    });

    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 800 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      workdir: DIR_A,
    });

    await webviewPage.getByTestId("desktop-automations-menu").click();
    await expect(webviewPage.getByTestId("automations-page")).toBeVisible();
    await expect(webviewPage.getByTestId("automations-empty")).toContainText(
      "还没有自动化",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-automations-empty.webp",
    );
  });
});
