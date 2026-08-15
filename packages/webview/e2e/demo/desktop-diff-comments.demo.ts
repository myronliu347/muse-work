import { test, expect } from "../utils/desktopTestHarness.js";
import { MessageInjector } from "../utils/messageInjector.js";
import { MockDataGenerator } from "../fixtures/mockData.js";
import { screenshotWebp } from "../utils/screenshot.js";

/**
 * Desktop workspace-diff pane + inline line-comment screenshots.
 *
 * Mirrors the real DiffPane → MessageInput path: the pane mounts and requests
 * `desktopGetWorkspaceDiff`; the test injects a mock `desktopWorkspaceDiff`
 * response, then exercises the GitHub/GitLab-style "+" comment button on a
 * diff line. Submitting the comment box appends a formatted diff comment to the
 * chat input (via the real ChatApp handleAddComment handler) — nothing is sent
 * to the agent, so several comments can be batched.
 */
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

/** Professional mock diff: a login form refactor + auth endpoint rename. */
const DIFF_FILES = [
  {
    path: "src/components/LoginForm.tsx",
    status: "modified",
    additions: 4,
    deletions: 2,
    truncated: false,
    binary: false,
    hunks: [
      "@@ -12,7 +12,9 @@ export function LoginForm() {",
      '   const [email, setEmail] = useState("");',
      '   const [password, setPassword] = useState("");',
      "-  const handleSubmit = (e) => {",
      "-    e.preventDefault();",
      "+  const handleSubmit = (e: React.FormEvent) => {",
      "+    e.preventDefault();",
      "+    if (!email || !password) return;",
      "+    setLoading(true);",
      "     api.login(email, password);",
      "   };",
    ].join("\n"),
  },
  {
    path: "src/hooks/useAuth.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    truncated: false,
    binary: false,
    hunks: [
      "@@ -5,6 +5,6 @@ export function useAuth() {",
      "   const [user, setUser] = useState(null);",
      "   const login = async (email, password) => {",
      "     try {",
      '-      const res = await api.post("/login", { email, password });',
      '+      const res = await api.post("/auth/login", { email, password });',
      "       setUser(res.data);",
      "       return res.data;",
    ].join("\n"),
  },
];

test.describe("Desktop Diff Pane Screenshots", () => {
  test("capture workspace diff pane + line comments", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1100, height: 680 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      workdir: DIR_A,
      session: {
        id: "sess-a1",
        sessionType: "main",
        workdir: DIR_A,
        createdAt: "2026-07-27T10:12:00Z",
        lastActiveAt: "2026-07-27T10:12:00Z",
        firstMessage: "帮我重构登录模块",
      },
    });
    await expect(webviewPage.getByTestId("chat-container")).toBeVisible();

    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "帮我重构登录模块，加上表单校验和 loading 状态",
        "msg-u1",
      ),
      MockDataGenerator.createAssistantMessage(
        "我重构了 `LoginForm` 的提交逻辑，给事件加了类型注解、空值校验和 loading 开关；同时把 `useAuth` 的登录端点从 `/login` 改到 `/auth/login` 与后端对齐。看一下差异面板的改动。",
        "msg-a1",
      ),
    ]);

    // ── 1. Open the diff pane via the header panel toggle ─────────
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await expect(webviewPage.getByTestId("panel-toggle-menu")).toBeVisible();
    await webviewPage.getByTestId("panel-toggle-item-diff").click();
    await webviewPage.keyboard.press("Escape"); // close the multi-select menu
    await expect(webviewPage.getByTestId("diff-pane")).toBeVisible();

    // DiffPane just requested desktopGetWorkspaceDiff; inject the response.
    await injector.simulateExtensionMessage("desktopWorkspaceDiff", {
      result: { kind: "ok", files: DIFF_FILES },
    });
    await expect(webviewPage.getByText("LoginForm.tsx")).toBeVisible();
    await expect(webviewPage.getByText("useAuth.ts")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-diff-pane.webp",
    );

    // ── 2. Click the "+" comment button on an added line ──────────
    // Hover a Pierre diff line so the gutter utility mounts, then click it.
    await webviewPage.locator(".diff-file-body [data-line]").first().hover();
    await webviewPage.getByTestId("diff-comment-add").click();
    await expect(webviewPage.getByTestId("diff-comment-box")).toBeVisible();
    await webviewPage
      .getByTestId("diff-comment-input")
      .fill("表单提交前先做空值校验，空字段直接返回");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-diff-comment.webp",
    );

    // ── 3. Submit appends the comment to the chat input ──────────
    await webviewPage.getByTestId("diff-comment-submit").click();
    await expect(webviewPage.getByTestId("message-input")).toContainText(
      "表单提交前先做空值校验",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-diff-comment-input.webp",
    );
  });
});
