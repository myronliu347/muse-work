# Session Header Git Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已有会话的分支/worktree 徽章挪到会话标题栏，并通过约 3s 轮询 `desktopListGitBranches` 反映外部切分支。

**Architecture:** `ChatHeader` 接收可选 `gitContext` 并渲染只读 `DesktopGitContext`。`ChatApp` 在非 draft 时把徽章从 `MessageInput.workdirSelector` 挪到 Header；分支优先 `paneGitBranches.current`。独立 effect 做 interval + `visibilitychange` 静默重查（不清空），workdir 变化仍先清空再查。

**Tech Stack:** React 18、zustand pane UI、Vitest + Testing Library（jsdom + fake timers）、现有 desktop IPC、pnpm

**Spec:** `docs/superpowers/specs/2026-08-15-session-header-git-branch-design.md`

## Global Constraints

- 仅改 webview：`ChatHeader` / `ChatApp` / 样式 / 测试 / e2e demo 断言位置
- 不改 host `listGitBranches` 协议；不做标题栏分支切换；不引入 `.git/HEAD` watch
- 轮询间隔约 **3000ms**；定时/可见性补查**不清空** `paneGitBranches`；workdir 变化先清空
- 分支显示：`paneGitBranches.current` 优先，未返回前回退 `session.worktreeBranch`；worktree 名仍用 `session.worktreeName`
- Draft：选择器留在输入区；标题栏不放徽章
- 包管理器：pnpm；验证：`pnpm -F @muse-work/webview exec vitest run <test-file>` + 相关 type-check

## File Structure

```text
packages/webview/src/types/index.ts                         # ChatHeaderProps.gitContext
packages/webview/src/components/chat/ChatHeader.tsx         # 渲染 DesktopGitContext
packages/webview/src/styles/ChatHeader.css                  # 标题栏徽章间距/截断
packages/webview/tests/components/ChatHeader.gitContext.test.tsx  # Header 单测
packages/webview/src/components/ChatApp.tsx                 # 挪徽章 + 轮询
packages/webview/tests/webview/sessionHeaderGitBranch.test.tsx    # 集成：位置 + 轮询更新
packages/webview/vitest.config.ts                           # include 新集成测试
packages/webview/e2e/demo/desktop-git-context.demo.ts       # 断言徽章在 chat-header 内
```

---

### Task 1: `ChatHeader` 接收并渲染 `gitContext`

**Files:**
- Modify: `packages/webview/src/types/index.ts`（`ChatHeaderProps`）
- Modify: `packages/webview/src/components/chat/ChatHeader.tsx`
- Modify: `packages/webview/src/styles/ChatHeader.css`
- Create: `packages/webview/tests/components/ChatHeader.gitContext.test.tsx`

**Interfaces:**
- Consumes: `DesktopGitContext`（`branch?: string; worktreeName?: string`）
- Produces:
  - `ChatHeaderProps.gitContext?: { branch?: string; worktreeName?: string }`
  - Header DOM：`chat-header` 内、`.header-buttons` 前渲染 `data-testid="desktop-git-context"`

- [ ] **Step 1: Write the failing test**

Create `packages/webview/tests/components/ChatHeader.gitContext.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { ChatHeader } from "../../src/components/chat/ChatHeader";

vi.mock("../../src/styles/ChatHeader.css", () => ({}));
vi.mock("../../src/styles/DesktopApp.css", () => ({}));

const baseProps = {
  onNewSession: () => {},
  onAbortMessage: () => {},
  messages: [],
  sessions: [],
  onSessionSelect: () => {},
  sessionsLoading: false,
  onOpenSettings: () => {},
  onLogin: () => {},
  onLogout: () => {},
  isAuthenticated: true,
  hideSessionButtons: true,
  hideMoreButton: true,
};

describe("ChatHeader gitContext", () => {
  it("renders DesktopGitContext inside the header when gitContext is set", () => {
    render(
      <ChatHeader
        {...baseProps}
        gitContext={{ branch: "feat/x", worktreeName: "x" }}
      />,
    );
    const header = screen.getByTestId("chat-header");
    expect(
      within(header).getByTestId("desktop-git-context"),
    ).toBeInTheDocument();
    expect(within(header).getByTestId("desktop-git-branch")).toHaveTextContent(
      "feat/x",
    );
    expect(
      within(header).getByTestId("desktop-git-worktree"),
    ).toHaveTextContent("x");
  });

  it("omits the badge when gitContext is absent", () => {
    render(<ChatHeader {...baseProps} />);
    expect(screen.queryByTestId("desktop-git-context")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/ChatHeader.gitContext.test.tsx`

Expected: FAIL（`gitContext` 非合法 prop / 找不到 `desktop-git-context`）

- [ ] **Step 3: Implement types + ChatHeader + CSS**

在 `ChatHeaderProps` 末尾增加：

```ts
  /** Desktop: read-only branch / worktree badge in the title bar. */
  gitContext?: { branch?: string; worktreeName?: string };
```

`ChatHeader.tsx`：

```tsx
import { DesktopGitContext } from "../desktop/DesktopGitContext";
// ...
export const ChatHeader: React.FC<ChatHeaderProps> = ({
  // ...existing
  panelToggle,
  gitContext,
}) => {
  // ...
  return (
    <div className="chat-header" data-testid="chat-header">
      <div className="header-title">{title}</div>
      {gitContext ? (
        <DesktopGitContext
          branch={gitContext.branch}
          worktreeName={gitContext.worktreeName}
        />
      ) : null}
      <div className="header-buttons">
        {/* unchanged */}
      </div>
      {/* popups unchanged */}
    </div>
  );
};
```

`ChatHeader.css` 追加：

```css
.chat-header > .desktop-git-context {
  flex-shrink: 1;
  min-width: 0;
  margin-inline-end: var(--space-2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/ChatHeader.gitContext.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/types/index.ts \
  packages/webview/src/components/chat/ChatHeader.tsx \
  packages/webview/src/styles/ChatHeader.css \
  packages/webview/tests/components/ChatHeader.gitContext.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): show git context badge in ChatHeader

EOF
)"
```

---

### Task 2: `ChatApp` 挪徽章 + 分支优先实时 HEAD

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`（`workdirSelector` + `ChatHeader` props）
- Create: `packages/webview/tests/webview/sessionHeaderGitBranch.test.tsx`（先写「位置」用例）
- Modify: `packages/webview/vitest.config.ts`（include 新文件）
- Modify: `packages/webview/e2e/demo/desktop-git-context.demo.ts`（断言在 header 内）

**Interfaces:**
- Consumes: `ChatHeaderProps.gitContext`（Task 1）
- Produces:
  - 非 draft：`ChatHeader` 收到 `gitContext`；`workdirSelector` 为 `undefined`
  - draft：`workdirSelector` 仍含 `DesktopWorkdirSelector` + `DesktopWorktreeControls`；Header 无 `gitContext`
  - 分支：`gitBranches?.current || session.worktreeBranch`（**不是** session 优先）

- [ ] **Step 1: Write the failing integration tests + register in vitest**

在 `vitest.config.ts` 的 `include` 数组追加：

```ts
"tests/webview/sessionHeaderGitBranch.test.tsx",
```

Create `packages/webview/tests/webview/sessionHeaderGitBranch.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { resetWebviewStores } from "../../src/stores";
import { createMockVscode, sendCommand, sendHostMessage } from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

function renderDesktop(workdir = "/work/a") {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir,
    recentWorkdirs: [workdir],
  });
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode };
}

beforeEach(() => {
  resetWebviewStores();
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
  document.head
    .querySelectorAll('script[src="./terminal.js"]')
    .forEach((s) => s.remove());
});

describe("session header git branch", () => {
  it("bound session shows git badge in chat-header, not in the input toolbar", () => {
    renderDesktop("/work/a");
    act(() => {
      sendCommand("updateCurrentSession", {
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/work/a",
          firstMessage: "hello",
          lastActiveAt: new Date().toISOString(),
          worktreeName: "login-fix",
          worktreeBranch: "worktree-login-fix",
        },
      });
    });
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: {
          branches: ["main", "worktree-login-fix"],
          current: "worktree-login-form",
        },
      });
    });

    const header = screen.getByTestId("chat-header");
    expect(
      within(header).getByTestId("desktop-git-context"),
    ).toBeInTheDocument();
    expect(within(header).getByTestId("desktop-git-branch")).toHaveTextContent(
      "worktree-login-form",
    );
    expect(
      within(header).getByTestId("desktop-git-worktree"),
    ).toHaveTextContent("login-fix");

    const inputToolbar = document.querySelector(".input-toolbar-left");
    expect(
      inputToolbar?.querySelector('[data-testid="desktop-git-context"]'),
    ).toBeNull();
  });

  it("draft keeps branch controls in the input area and omits header badge", () => {
    renderDesktop("/work/a");
    // No bound session → draft / new-session UI
    act(() => {
      sendCommand("desktopGitBranches", {
        workdir: "/work/a",
        result: { branches: ["main", "dev"], current: "main" },
      });
    });

    expect(screen.getByTestId("desktop-worktree-controls")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("chat-header")).queryByTestId(
        "desktop-git-context",
      ),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/sessionHeaderGitBranch.test.tsx`

Expected: FAIL（徽章仍在输入区 / header 内无徽章）

- [ ] **Step 3: Wire ChatApp**

计算（靠近其它 session 派生值处）：

```ts
const sessionMeta = state.currentSession as
  | { worktreeBranch?: string; worktreeName?: string }
  | undefined;
const headerGitContext =
  isDesktop && !isDraftSession
    ? {
        branch:
          gitBranches?.current || sessionMeta?.worktreeBranch || undefined,
        worktreeName: sessionMeta?.worktreeName,
      }
    : undefined;
```

`workdirSelector`：仅 draft 时渲染选择器；**删除**非 draft 的 `<DesktopGitContext … />` 分支：

```tsx
workdirSelector={
  host?.type === "desktop" && isDraftSession ? (
    <>
      <DesktopWorkdirSelector /* unchanged */ />
      {effectiveWorkdir &&
        gitBranches &&
        gitBranches.branches.length > 0 && (
          <DesktopWorktreeControls /* unchanged */ />
        )}
    </>
  ) : undefined
}
```

`ChatHeader` 增加：

```tsx
gitContext={headerGitContext}
```

若 `DesktopGitContext` 仅在 Header 使用，可保留 ChatApp 的 import（Header 自己 import）；ChatApp 可去掉对 `DesktopGitContext` 的 import。

- [ ] **Step 4: Update e2e demo assertion**

`desktop-git-context.demo.ts` 中「Bound session」用例，在现有 `getByTestId("desktop-git-context")` 断言前加：

```ts
const header = webviewPage.getByTestId("chat-header");
await expect(header.getByTestId("desktop-git-context")).toBeVisible();
```

（保留分支/worktree 文案断言即可。）

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/sessionHeaderGitBranch.test.tsx tests/components/ChatHeader.gitContext.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx \
  packages/webview/tests/webview/sessionHeaderGitBranch.test.tsx \
  packages/webview/vitest.config.ts \
  packages/webview/e2e/demo/desktop-git-context.demo.ts
git commit -m "$(cat <<'EOF'
feat(webview): move session git badge into chat header

EOF
)"
```

---

### Task 3: 轮询 + visibility 补查

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`（git branches effects）
- Modify: `packages/webview/tests/webview/sessionHeaderGitBranch.test.tsx`（追加轮询用例）

**Interfaces:**
- Consumes: 现有 `postToHost` + `desktopListGitBranches` / `desktopGitBranches`
- Produces:
  - 常量间隔 `3000` ms 静默重查（`document.visibilityState !== "hidden"`）
  - `visibilitychange` → `visible` 时立刻补查一次
  - 定时路径**不** `patchPane({ paneGitBranches: null })`
  - workdir 变化路径仍先清空再查（现有语义）

- [ ] **Step 1: Write the failing poll-update test**

在 `sessionHeaderGitBranch.test.tsx` 追加：

```tsx
  it("updates header branch when a later desktopGitBranches current changes", () => {
    vi.useFakeTimers();
    try {
      renderDesktop("/work/a");
      act(() => {
        sendCommand("updateCurrentSession", {
          session: {
            id: "s1",
            sessionType: "main",
            workdir: "/work/a",
            firstMessage: "hello",
            lastActiveAt: new Date().toISOString(),
            worktreeBranch: "old-branch",
          },
        });
      });
      act(() => {
        sendCommand("desktopGitBranches", {
          workdir: "/work/a",
          result: { branches: ["old-branch", "new-branch"], current: "old-branch" },
        });
      });
      expect(
        within(screen.getByTestId("chat-header")).getByTestId(
          "desktop-git-branch",
        ),
      ).toHaveTextContent("old-branch");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      // Interval should have posted another desktopListGitBranches (assert optional).
      // Simulate host reply with new HEAD:
      act(() => {
        sendCommand("desktopGitBranches", {
          workdir: "/work/a",
          result: { branches: ["old-branch", "new-branch"], current: "new-branch" },
        });
      });
      expect(
        within(screen.getByTestId("chat-header")).getByTestId(
          "desktop-git-branch",
        ),
      ).toHaveTextContent("new-branch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts desktopListGitBranches on the poll interval without clearing first", () => {
    vi.useFakeTimers();
    try {
      const { vscode } = renderDesktop("/work/a");
      act(() => {
        sendCommand("updateCurrentSession", {
          session: {
            id: "s1",
            sessionType: "main",
            workdir: "/work/a",
            firstMessage: "hello",
            lastActiveAt: new Date().toISOString(),
          },
        });
      });
      act(() => {
        sendCommand("desktopGitBranches", {
          workdir: "/work/a",
          result: { branches: ["main"], current: "main" },
        });
      });
      vscode.postMessage.mockClear();

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "desktopListGitBranches",
          workdir: "/work/a",
        }),
      );
      // Badge must still show previous current (no clear-to-null flash)
      expect(
        within(screen.getByTestId("chat-header")).getByTestId(
          "desktop-git-branch",
        ),
      ).toHaveTextContent("main");
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run test to verify poll posting fails (or second case fails)**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/sessionHeaderGitBranch.test.tsx`

Expected: FAIL（advance 3s 后没有新的 `desktopListGitBranches`）

- [ ] **Step 3: Implement polling in ChatApp**

替换/拆分现有「仅 workdir 变化查询」的 effect（约 969–978 行）为：

```ts
const GIT_BRANCH_POLL_MS = 3000;

const requestPaneGitBranches = useCallback(
  (opts?: { clear?: boolean }) => {
    if (!isDesktop) return;
    if (!effectiveWorkdir) {
      if (opts?.clear) patchPane({ paneGitBranches: null });
      return;
    }
    if (opts?.clear) patchPane({ paneGitBranches: null });
    postToHost({
      command: "desktopListGitBranches",
      workdir: effectiveWorkdir,
      paneId,
    });
  },
  [effectiveWorkdir, isDesktop, paneId, patchPane, postToHost],
);

// workdir change: clear then fetch (existing semantics)
useEffect(() => {
  requestPaneGitBranches({ clear: true });
}, [requestPaneGitBranches]);

// poll + resume on visibility
useEffect(() => {
  if (!isDesktop || !effectiveWorkdir) return;

  const poll = () => {
    if (document.visibilityState === "hidden") return;
    requestPaneGitBranches();
  };

  const id = window.setInterval(poll, GIT_BRANCH_POLL_MS);
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      requestPaneGitBranches();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}, [effectiveWorkdir, isDesktop, requestPaneGitBranches]);
```

注意：

- `requestPaneGitBranches` 依赖含 `effectiveWorkdir`，workdir 切换会重建 callback → 第一个 effect 再跑一次清空查询（正确）。
- 第二个 effect 在 hidden 时跳过 tick；visible 时补查**不清空**。
- 保留原注释中「勿依赖 host 对象 / host.workdir」的意图：仍只依赖 `effectiveWorkdir`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/sessionHeaderGitBranch.test.tsx tests/components/ChatHeader.gitContext.test.tsx`

Expected: PASS

可选：`pnpm -F @muse-work/webview type-check`（若包脚本存在）应通过。

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx \
  packages/webview/tests/webview/sessionHeaderGitBranch.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): poll git branches to refresh header badge

EOF
)"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 徽章挪到标题栏 | Task 1–2 |
| 分支 + worktree 名 | Task 1–2 |
| Draft 选择器留输入区 | Task 2 |
| 已有会话输入区无徽章 | Task 2 |
| 实时 HEAD 优先于 session.worktreeBranch | Task 2 |
| 3s 轮询、定时不清空 | Task 3 |
| visibility 暂停/补查 | Task 3 |
| 不改 host 协议 / 不做切换 UI / 不做 fs.watch | 全任务遵守 |

无 TBD；类型名 `gitContext` / `desktopListGitBranches` 前后一致。
