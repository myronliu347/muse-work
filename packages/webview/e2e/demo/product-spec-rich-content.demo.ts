import { test } from "../utils/webviewTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { type Message } from "@muse-work/agent";
import { screenshotWebp, elementScreenshotWebp } from "../utils/screenshot.js";

test.describe("Product Specification Screenshots - Rich Content", () => {
  test("capture rich content features", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Set viewport size for better screenshots (simulating VS Code sidebar)
    await webviewPage.setViewportSize({ width: 400, height: 800 });

    // Provide initial state with valid configuration
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      configurationData: {
        apiKey: "sk-ant-api03-CXB9pH2k...mH8wQz",
        baseURL: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-20250514",
        fastModel: "claude-haiku-4-20250514",
      },
      permissionMode: "default",
    });

    // 13. Inline Context Tags (Mentions)
    await webviewPage.focus('[data-testid="message-input"]');
    await webviewPage.keyboard.press("Control+A");
    await webviewPage.keyboard.press("Backspace");

    // 13a. Insert Folder Tag
    await webviewPage.keyboard.type("@");

    // Capture the actual requestId from the message log
    const getLatestRequestId = async () => {
      return await webviewPage.evaluate(() => {
        const messages = window.getTestMessages ? window.getTestMessages() : [];
        const reqs = messages.filter(
          (m) => m.command === "requestFileSuggestions",
        );
        return reqs.length > 0
          ? reqs[reqs.length - 1].requestId
          : "fallback-id";
      });
    };

    // Wait for the debounced requestFileSuggestions request
    await injector.waitForFileSuggestionRequest();

    await injector.simulateExtensionMessage("fileSuggestionsResponse", {
      requestId: await getLatestRequestId(),
      filterText: "",
      suggestions: [
        {
          path: "src",
          relativePath: "src",
          name: "src",
          icon: "codicon-folder",
          isDirectory: true,
        },
      ],
    });
    await webviewPage.waitForSelector(".suggestion-item", { state: "visible" });
    await webviewPage.keyboard.press("ArrowDown");
    await webviewPage.keyboard.press("Enter");

    await webviewPage.keyboard.type(" 这是文本 ");

    // 13b. Insert File Tag
    const countBeforeSecondAt = await injector.getMessageCount();
    await webviewPage.keyboard.type("@");
    await injector.waitForFileSuggestionRequest(2000, countBeforeSecondAt);

    await injector.simulateExtensionMessage("fileSuggestionsResponse", {
      requestId: await getLatestRequestId(),
      filterText: "",
      suggestions: [
        {
          path: "src/main.ts",
          relativePath: "src/main.ts",
          name: "main.ts",
          icon: "codicon-file-code",
          isDirectory: false,
        },
      ],
    });
    await webviewPage.waitForSelector(".suggestion-item", { state: "visible" });
    await webviewPage.keyboard.press("ArrowDown");
    await webviewPage.keyboard.press("Enter");

    await webviewPage.keyboard.type(" 这是图片 ");

    // 13c. Insert Image Tag (via paste) — tiny 1×1 PNG fixture
    const logoDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    await webviewPage.evaluate(async (dataUrl) => {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "logo.png", { type: "image/png" });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const event = new ClipboardEvent("paste", {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      });
      document.getElementById("messageInput")?.dispatchEvent(event);
    }, logoDataUrl);

    // Wait for folder + file tags (image paste is optional / host-dependent)
    await webviewPage.waitForFunction(
      () => {
        return document.querySelectorAll(".context-tag").length >= 2;
      },
      { timeout: 5000 },
    );

    await elementScreenshotWebp(
      webviewPage.locator(".input-container"),
      "../../docs/public/screenshots/spec-inline-mentions.webp",
    );

    // 13d. Image Preview Modal (only when paste created an image tag)
    const imageTag = webviewPage.locator(".context-tag.is-image");
    if ((await imageTag.count()) > 0) {
      await imageTag.click();
      await webviewPage.waitForSelector(".image-preview-modal", {
        state: "visible",
      });
      await screenshotWebp(
        webviewPage,
        "../../docs/public/screenshots/spec-image-preview.webp",
      );

      // Close modal
      await webviewPage.click(".image-preview-close");
      await webviewPage.waitForSelector(".image-preview-modal", {
        state: "hidden",
      });
    }

    // 13b. Message List with Inline Tags
    await injector.updateMessages([
      {
        id: "msg_demo_inline_tags",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [
          {
            type: "text",
            content:
              "[@file:src/services] 分析这个服务目录 [@file:src/services/payment/PaymentService.ts] 这是相关截图 [image1]",
          },
        ],
      },
    ]);
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/spec-message-inline-tags.webp",
    );

    // 22. Vision
    const visionMessages = [
      {
        id: "msg_demo_vision_user",
        role: "user",
        blocks: [
          {
            type: "text",
            content: "请分析这个 UI 设计稿，帮我生成对应的 React 组件 [image1]",
          },
          {
            type: "image",
            imageUrls: [
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            ],
          },
        ],
      },
      MockDataGenerator.createAssistantMessage(
        "这是一个支付确认页面的设计稿。我可以识别出以下元素：\n\n1. **顶部导航栏** - 包含返回按钮和标题\n2. **金额展示区** - 大号字体显示支付金额\n3. **支付方式选择** - 支持银行卡和电子钱包\n4. **底部确认按钮** - 固定在底部\n\n我将基于这些元素生成对应的 React 组件...",
      ),
    ];
    await injector.updateMessages(visionMessages as unknown as Message[]);
    await elementScreenshotWebp(
      webviewPage.locator(".messages-container"),
      "../../docs/public/screenshots/spec-vision.webp",
    );
  });
});
