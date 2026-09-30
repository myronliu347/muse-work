import { test, expect } from "../utils/webviewTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { AGENT_TOOL_NAME, type Message } from "@muse-work/agent";
import { screenshotWebp, elementScreenshotWebp } from "../utils/screenshot.js";

test.describe("Agent transcript / compaction / user nav", () => {
  test("agent transcript popup opens from subagent row", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 480, height: 720 });

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
    });

    const subagentMessage: Message = {
      id: "msg_demo_subagent_transcript",
      role: "assistant",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [
        {
          type: "tool",
          id: "agent-tool-1",
          name: AGENT_TOOL_NAME,
          stage: "end",
          compactParams: "Explore: 查找支付 API",
          parameters: JSON.stringify({
            subagent_type: "Explore",
            description: "查找支付 API",
            prompt: "列出所有支付相关路由",
          }),
          shortResult: "Read, Grep (2 tools | 1,024 tokens)",
          nestedMessages: [
            MockDataGenerator.createUserMessage(
              "列出所有支付相关路由",
              "nested-u1",
            ),
            MockDataGenerator.createAssistantMessage(
              "找到 `src/routes/payment.ts` 与 `src/api/pay.ts` 两处入口。",
              "nested-a1",
            ),
          ],
        } as Message["blocks"][number],
      ],
    };

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "帮我查一下支付相关 API",
        "msg_user_subagent",
      ),
      subagentMessage,
    ]);
    // Prefer the host-side transcript map (same path as streaming subagents).
    await injector.simulateExtensionMessage("setSubagentMessages", {
      subagentId: "agent-tool-1",
      messages: [
        MockDataGenerator.createUserMessage(
          "列出所有支付相关路由",
          "nested-u1",
        ),
        MockDataGenerator.createAssistantMessage(
          "找到 src/routes/payment.ts 与 src/api/pay.ts 两处入口。",
          "nested-a1",
        ),
      ],
    });

    await webviewPage.getByTestId("agent-tool-row").click();
    await expect(
      webviewPage.getByTestId("agent-transcript-popup"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("agent-transcript-popup"),
    ).toContainText("找到 src/routes/payment.ts");
    await elementScreenshotWebp(
      webviewPage.getByTestId("agent-transcript-popup"),
      "../../docs/public/screenshots/spec-agent-transcript.webp",
    );
  });

  test("compaction hint and /clear command", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 400, height: 600 });

    await injector.simulateExtensionMessage("setInitialState", {
      messages: [
        MockDataGenerator.createUserMessage("先聊几句", "u1"),
        MockDataGenerator.createAssistantMessage("好的。", "a1"),
      ],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      configurationData: {
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    await injector.simulateExtensionMessage("compactionStateChange", {
      isCompacting: true,
    });
    await expect(webviewPage.getByTestId("compaction-hint")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-compaction-hint.webp",
    );

    await injector.simulateExtensionMessage("compactionStateChange", {
      isCompacting: false,
    });

    await injector.clearMessageLog();
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.type("/clear");
    await webviewPage.keyboard.press("Enter");
    await injector.waitForMessage("clearChat");
  });

  test("user message nav lists conversation anchors", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 400, height: 700 });

    const messages = [
      MockDataGenerator.createUserMessage("第一轮：分析并发问题", "nav-u1"),
      MockDataGenerator.createAssistantMessage(
        "发现 processPayment 存在竞态。\n\n".repeat(8),
        "nav-a1",
      ),
      MockDataGenerator.createUserMessage("第二轮：加乐观锁", "nav-u2"),
      MockDataGenerator.createAssistantMessage(
        "已改为乐观锁并补充重试。\n\n".repeat(8),
        "nav-a2",
      ),
      MockDataGenerator.createUserMessage("第三轮：补单测", "nav-u3"),
      MockDataGenerator.createAssistantMessage(
        "新增 5 个并发场景测试。\n\n".repeat(8),
        "nav-a3",
      ),
    ];

    await injector.simulateExtensionMessage("setInitialState", {
      messages,
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      configurationData: {
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    await expect(webviewPage.getByTestId("user-message-nav")).toBeVisible();
    await expect(
      webviewPage.getByTestId("user-message-nav-nav-u1"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("user-message-nav-nav-u3"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/spec-user-message-nav.webp",
    );
  });
});
