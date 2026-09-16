import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { READ_TOOL_NAME } from "wave-agent-sdk";
import { screenshotWebp } from "../utils/screenshot.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const SAMPLE_MD = `# Yui 模式前端适配 — lcap-ide 侧实施计划

Goal：让 lcap-ide 的 Spec 客户端按 mode 渲染：\`yui\` 的 Spec 一律不渲染、不诱导操作。

## 顺带一个必须做的决策

> Q23：既然用户在落库后已选了「确定」，当条消息重复投递，还是仅推提醒入框里再点一次发送？
>
> 建议走后者。这是 Part A 的 D3（「推进输入框，可见可编辑」）冲量。

另外悄悄一件事：这个落地性质很边缘（它不在本仓库，我放不下）。

## 必须改（改不动就会返工）

### P1 与 D3 目标组相冲突

Task 7 写的是「结果投递入框，用户再点发送」；但入口流结果则「推进需求 × 确定」。

- Task 7 和 Task 8 是 **同一个组件、同一块区域**
- 我在 \`selfcheck.md\` 里把 Task 18 又写成「它」——同一交付物两套，且 Task 11 在 Part A 未附

1. 先确认方案
2. 再写清单
3. 用户说开工后再 dispatch

## 已拍板决策

| ID | 决策 | 状态 |
| --- | --- | --- |
| D1 | 空入口区 = 空 Spec 落地到「能添需求 × 确定」 | 已拍板 |
| D2 | Yui 的入口元素隐藏，不沿用 \`s-spec-step-header.vue\` | 已拍板 |
| D3 | 推进框内可见可编辑 | 待确认 |

- [x] 标题层级与分隔
- [x] 引用块不再斜体
- [ ] 表格圆角与斑马纹
- [ ] 代码块对比度

\`\`\`bash
cd /Users/dev/projects/wave-agent
pnpm exec vitest run packages/lcap-snippets
\`\`\`

---

正文行高拉到约 1.7，长中文计划不再挤成一块灰。
`;

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

test.describe("Desktop markdown render polish", () => {
  test("chat long-doc and file preview share the reading styles", async ({
    webviewPage,
  }) => {
    test.setTimeout(20_000);
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
      session: {
        id: "sess-md",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: "2026-09-16T10:00:00Z",
        lastActiveAt: "2026-09-16T10:00:00Z",
        firstMessage: "看下这份实施计划",
      },
    });
    const mdPath = `${DIR_A}/docs/superpowers/plans/yui-mode.md`;
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("看下这份实施计划", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        SAMPLE_MD,
        READ_TOOL_NAME,
        JSON.stringify({ file_path: mdPath }),
        "读取完成",
      ),
    ]);

    await expect(webviewPage.locator(".markdown-content h1")).toContainText(
      "Yui 模式前端适配",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-markdown-chat.webp",
    );

    await webviewPage.locator(".write-tool-path").click();
    await injector.waitForMessage("openFile");
    await expect(webviewPage.getByTestId("file-pane")).toBeVisible();
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: mdPath,
        host: "local",
        loading: false,
        content: SAMPLE_MD,
      },
    });
    await expect(webviewPage.locator(".file-pane-markdown h1")).toContainText(
      "Yui 模式前端适配",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-markdown-file.webp",
    );
  });
});
