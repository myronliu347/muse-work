# 桌面布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面端改成图标栏加 Muse Bot 主页：Issue 不进会话列表，中间用标签切换会话，点待办只切右侧「详情」。

**Architecture:** 纯函数 `botWorkspace` 保存中间标签、列表选中和右侧标签，三者互不改写。`DesktopShell` 默认 `shellView = "assistant"`。图标栏始终在左；「会话」才展开现在的会话树（不含 Issue）；Muse Bot 在焦点窗格里画标签、对话和宽屏卡片；右侧停靠栏在现有文件/终端/浏览器/变更之前固定一个不可关闭的「详情」。打开 Issue 会话只改 `botWorkspace`，不调用 `host.onSelectSession`。

**Tech Stack:** TypeScript、React、Vitest、Testing Library。只改 `packages/webview`。

**Spec:** `docs/superpowers/specs/2026-10-22-desktop-layout-design.md`

## Global Constraints

- 左侧只有四个图标，宽 52px，悬停出名称。顺序：Muse Bot、会话、自动化、设置。
- 默认主页是 Muse Bot。有 Issue 标签打开时，Muse Bot 图标仍选中。
- 会话列表只有置顶和普通工作区会话。Issue 分组不渲染。
- 点待处理或待办：选中该项，右侧切到「详情」，中间标签不动。
- 「打开会话」把 Issue 加进中间标签并切过去。「切到会话」只切标签。两者都不改右侧当前标签。
- 关掉当前 Issue 标签回到 Muse Bot。标签只活在本次运行，不持久化。
- 视口宽度 `>= 1240` 时，两张卡片在对话右侧、顶部对齐，不盖住消息。更窄时，标签栏右侧两个图标按钮，角标是数量。
- 右侧标签顺序：详情、文件、终端、浏览器、变更。「详情」不进 `DesktopPanelKind`，不进添加菜单，不能关闭。后四项的种类和标签名不变。
- 选中 Issue 时，后四项跟随该 Issue 的工作目录。选中待处理时，详情显示事件，后四项留在最近一次 Issue。没有任何 Issue 时，后四项保持现在的工作区。
- 进入主页时若有待办，详情显示第一项，中间仍是 Muse Bot。
- Issue 标签里的会话：有 `executionSessionId` 用执行会话，否则用规划会话。一个 Issue 一个标签。
- 设置是整页，内容是现在的 `ConfigDialog`，不再弹对话框。未登录时「登录」放在设置页顶上，`data-testid="desktop-login-btn"` 保留。
- 自动化页和设置页不显示右侧面板。
- 不改服务端协议、助理队列和 Issue 模型。

---

### Task 1: 工作区状态

**Files:**
- Create: `packages/webview/src/components/desktop/botWorkspace.ts`
- Test: `packages/webview/tests/components/botWorkspace.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export type PanelSelection = { kind: "issue"; issueId: string } | { kind: "queue"; id: string } | { kind: "none" }`
  - `export type DockChrome = "detail" | "file" | "terminal" | "preview" | "diff"`
  - `export interface BotWorkspaceState { active: "bot" | string; openIssueIds: string[]; panel: PanelSelection; dock: DockChrome; lastIssueId: string | null }`
  - `export function initialBotWorkspace(firstIssueId: string | null): BotWorkspaceState`
  - `export function selectPanel(state: BotWorkspaceState, panel: Exclude<PanelSelection, { kind: "none" }>): BotWorkspaceState`
  - `export function openIssueSession(state: BotWorkspaceState, issueId: string): BotWorkspaceState`
  - `export function focusTab(state: BotWorkspaceState, tab: "bot" | string): BotWorkspaceState`
  - `export function closeIssueTab(state: BotWorkspaceState, issueId: string): BotWorkspaceState`
  - `export function selectDock(state: BotWorkspaceState, dock: DockChrome): BotWorkspaceState`
  - `export function sessionActionLabel(state: BotWorkspaceState, issueId: string): "打开会话" | "切到会话" | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  closeIssueTab,
  focusTab,
  initialBotWorkspace,
  openIssueSession,
  selectDock,
  selectPanel,
  sessionActionLabel,
} from "../../src/components/desktop/botWorkspace";

describe("botWorkspace", () => {
  it("opens on Muse Bot with the first issue only in the detail panel", () => {
    const state = initialBotWorkspace("radii");
    expect(state.active).toBe("bot");
    expect(state.openIssueIds).toEqual([]);
    expect(state.panel).toEqual({ kind: "issue", issueId: "radii" });
    expect(state.dock).toBe("detail");
    expect(state.lastIssueId).toBe("radii");
  });

  it("selecting a list item does not open or switch the center tab", () => {
    const opened = openIssueSession(initialBotWorkspace("radii"), "radii");
    const next = selectPanel(opened, { kind: "issue", issueId: "a11y" });
    expect(next.active).toBe("radii");
    expect(next.openIssueIds).toEqual(["radii"]);
    expect(next.panel).toEqual({ kind: "issue", issueId: "a11y" });
    expect(next.dock).toBe("detail");
    expect(next.lastIssueId).toBe("a11y");
  });

  it("selecting a queue item keeps the last issue for the tool tabs", () => {
    const next = selectPanel(initialBotWorkspace("radii"), {
      kind: "queue",
      id: "ty",
    });
    expect(next.panel).toEqual({ kind: "queue", id: "ty" });
    expect(next.dock).toBe("detail");
    expect(next.lastIssueId).toBe("radii");
    expect(next.active).toBe("bot");
  });

  it("open session adds a tab and leaves the dock tab alone", () => {
    const onFile = selectDock(initialBotWorkspace("radii"), "file");
    const next = openIssueSession(onFile, "radii");
    expect(next.active).toBe("radii");
    expect(next.openIssueIds).toEqual(["radii"]);
    expect(next.dock).toBe("file");
  });

  it("focus and close only change center tabs", () => {
    const opened = openIssueSession(
      openIssueSession(initialBotWorkspace("radii"), "radii"),
      "a11y",
    );
    expect(focusTab(opened, "bot").active).toBe("bot");
    expect(focusTab(opened, "bot").dock).toBe("detail");
    const closed = closeIssueTab(opened, "a11y");
    expect(closed.active).toBe("bot");
    expect(closed.openIssueIds).toEqual(["radii"]);
  });

  it("names the detail button from tab state", () => {
    const initial = initialBotWorkspace("radii");
    expect(sessionActionLabel(initial, "radii")).toBe("打开会话");
    const opened = openIssueSession(initial, "radii");
    expect(sessionActionLabel(focusTab(opened, "bot"), "radii")).toBe("切到会话");
    expect(sessionActionLabel(opened, "radii")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/botWorkspace.test.ts`

Expected: FAIL，找不到 `botWorkspace`。

- [ ] **Step 3: Write minimal implementation**

```ts
export type PanelSelection =
  | { kind: "issue"; issueId: string }
  | { kind: "queue"; id: string }
  | { kind: "none" };

export type DockChrome = "detail" | "file" | "terminal" | "preview" | "diff";

export interface BotWorkspaceState {
  active: "bot" | string;
  openIssueIds: string[];
  panel: PanelSelection;
  dock: DockChrome;
  lastIssueId: string | null;
}

export function initialBotWorkspace(firstIssueId: string | null): BotWorkspaceState {
  return {
    active: "bot",
    openIssueIds: [],
    panel: firstIssueId ? { kind: "issue", issueId: firstIssueId } : { kind: "none" },
    dock: "detail",
    lastIssueId: firstIssueId,
  };
}

export function selectPanel(
  state: BotWorkspaceState,
  panel: Exclude<PanelSelection, { kind: "none" }>,
): BotWorkspaceState {
  return {
    ...state,
    panel,
    dock: "detail",
    lastIssueId: panel.kind === "issue" ? panel.issueId : state.lastIssueId,
  };
}

export function openIssueSession(state: BotWorkspaceState, issueId: string): BotWorkspaceState {
  return {
    ...state,
    active: issueId,
    openIssueIds: state.openIssueIds.includes(issueId)
      ? state.openIssueIds
      : [...state.openIssueIds, issueId],
  };
}

export function focusTab(state: BotWorkspaceState, tab: "bot" | string): BotWorkspaceState {
  if (tab !== "bot" && !state.openIssueIds.includes(tab)) return state;
  return { ...state, active: tab };
}

export function closeIssueTab(state: BotWorkspaceState, issueId: string): BotWorkspaceState {
  const openIssueIds = state.openIssueIds.filter((id) => id !== issueId);
  return {
    ...state,
    openIssueIds,
    active: state.active === issueId ? "bot" : state.active,
  };
}

export function selectDock(state: BotWorkspaceState, dock: DockChrome): BotWorkspaceState {
  return { ...state, dock };
}

export function sessionActionLabel(
  state: BotWorkspaceState,
  issueId: string,
): "打开会话" | "切到会话" | null {
  if (!state.openIssueIds.includes(issueId)) return "打开会话";
  if (state.active === issueId) return null;
  return "切到会话";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/botWorkspace.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/botWorkspace.ts packages/webview/tests/components/botWorkspace.test.ts
git commit -m "feat: add desktop bot workspace state"
```

---

### Task 2: 图标栏与默认主页

**Files:**
- Modify: `packages/webview/src/components/desktop/shellSurface.tsx`
- Modify: `packages/webview/src/components/desktop/DesktopShell.tsx`（`shellView` 初值与四个导航回调）
- Modify: `packages/webview/src/components/desktop/DesktopSidebar.tsx`
- Modify: `packages/webview/src/styles/DesktopApp.css`（图标栏宽度）
- Modify: `packages/webview/src/muse/layout.ts`（`DESKTOP_SIDEBAR_WIDTH` 在图标栏下固定为 52，不再拖拽）
- Test: `packages/webview/tests/components/iconRail.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces:
  - `ShellSurface = "assistant" | "sessions" | "automations" | "settings"`
  - 图标按钮 test id：`desktop-assistant-menu`、`desktop-sessions-menu`、`desktop-automations-menu`、`desktop-settings-btn`
  - `DesktopShell` 初始 `shellView` 为 `"assistant"`

`ShellSurface` 去掉 `"chat"`。原来的窗格聊天改由 `"sessions"` 表示。`useShellSurface()` 的默认值改为 `"assistant"`。

- [ ] **Step 1: Write the failing test**

渲染带窗格的 `DesktopShell`（沿用 `DesktopApp.test.tsx` 的 host fixture，至少一条普通会话和一个 Issue）。断言：

- `desktop-assistant-menu` 带 `active`
- 不存在 `desktop-new-session`、`desktop-session-section-issues`、`desktop-brand`
- `desktop-sessions-menu`、`desktop-automations-menu`、`desktop-settings-btn` 存在，且都有 `aria-label`
- 点击 `desktop-sessions-menu` 后，`desktop-assistant-menu` 不再 `active`，出现 `desktop-new-session`
- 点击 `desktop-assistant-menu` 后，Muse Bot 重新 `active`，`desktop-new-session` 消失

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/iconRail.test.tsx`

Expected: FAIL，首屏仍是会话侧栏。

- [ ] **Step 3: Write minimal implementation**

`DesktopSidebar` 删掉应用菜单、分隔线、`SessionTree`、底栏 logo。根节点改成图标列，宽 52px。四个按钮只放图标，名称用 `title` 和 `aria-label`。Muse Bot 用星芒 SVG，设置为六齿齿轮 SVG，线条宽 1.6，与现有会话气泡、时钟同一套 `currentColor`。未读点留在 Muse Bot 按钮上，test id 仍是 `assistant-unread-dot`。

`DesktopShell`：

```ts
const [shellView, setShellView] = useState<ShellSurface>("assistant");
```

回调：

- Muse Bot → `setShellView("assistant")`
- 会话 → `setShellView("sessions")`
- 自动化 → `setShellView("automations")`
- 设置 → `setShellView("settings")`，不要调用 `onOpenSettings`

`activeMenu` 直接等于 `shellView`。`menuOwnsSelection` 在 `"assistant" | "automations" | "settings"` 时为真。图标栏不接收 `issueGroups`，也不渲染拖拽条。

`shellView === "automations"` 仍渲染 `AutomationsPage`。`"settings"` 在 Task 4 接上之前先渲染空的 `data-testid="desktop-settings-page"`。`"sessions"` 和 `"assistant"` 仍走窗格行；`"assistant"` 时焦点窗格由现有 `shellSurface === "assistant"` 显示助理。

CSS：`.desktop-layout` 的侧栏宽改为 52px。删掉图标栏上的 resize handle。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/iconRail.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/shellSurface.tsx packages/webview/src/components/desktop/DesktopShell.tsx packages/webview/src/components/desktop/DesktopSidebar.tsx packages/webview/src/styles/DesktopApp.css packages/webview/src/muse/layout.ts packages/webview/tests/components/iconRail.test.tsx
git commit -m "feat: replace desktop sidebar with an icon rail"
```

---

### Task 3: 会话列表去掉 Issue

**Files:**
- Modify: `packages/webview/src/components/desktop/DesktopShell.tsx`
- Modify: `packages/webview/src/components/session/SessionTree.tsx`（桌面这条路径不传 `issueGroups`）
- Test: `packages/webview/tests/components/DesktopSidebar.sessions.test.tsx`
- Test: `packages/webview/tests/components/DesktopApp.test.tsx`

**Interfaces:**
- Consumes: `ShellSurface` 的 `"sessions"`
- Produces: `shellView === "sessions"` 时，图标栏右侧出现 `data-testid="desktop-session-list"`，里面是现在的 `SessionTree`，不传 `issueGroups`

- [ ] **Step 1: Write the failing test**

在 `iconRail.test.tsx` 补一条：host 同时有普通会话和 Issue。点击 `desktop-sessions-menu` 后，`desktop-session-list` 里能看到普通会话标题，`queryByTestId("desktop-session-section-issues")` 为 `null`。点击普通会话调用 `onSelectSession`，并且 `shellView` 仍是会话（`desktop-sessions-menu` 保持 `active`）。

把 `DesktopApp.test.tsx` 里「首屏同时看到会话项和 Issue 区」改成：首屏没有 Issue 区；点开会话后看得到会话项，仍然没有 Issue 区。

`DesktopSidebar.sessions.test.tsx` 里所有 `desktop-session-section-issues` 断言删除或改到 Task 6 的待办卡片。`desktop-new-session` 只在会话列表里断言。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/iconRail.test.tsx tests/components/DesktopApp.test.tsx`

Expected: FAIL，会话列表还没单独挂出来，或 Issue 区仍在。

- [ ] **Step 3: Write minimal implementation**

`shellView === "sessions"` 时，在图标栏和窗格行之间渲染：

```tsx
<aside className="desktop-session-list" data-testid="desktop-session-list">
  <SessionTree
    {...resolveSidebarSessions({ sessionTree: host.sessionTree })}
    currentSessionId={focusedSessionId}
    visibleSessionIds={visibleSessionIds}
    onSelectSession={(workdir, sessionId) => {
      host.onSelectSession(workdir, sessionId);
    }}
  />
</aside>
```

不传 `issueGroups`、`onSelectIssue`、`onNewIssue`。`SessionTree` 渲染 Issue 分组的条件改成 `issueGroups?.length`，空数组和 `undefined` 都不渲染。

「新对话」按钮放在 `desktop-session-list` 顶部，test id 仍是 `desktop-new-session`，点击执行现在的 `onNewSession`（`setShellView("sessions")` 加 `newSession`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/iconRail.test.tsx tests/components/DesktopApp.test.tsx tests/components/DesktopSidebar.sessions.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/DesktopShell.tsx packages/webview/src/components/session/SessionTree.tsx packages/webview/tests/components/iconRail.test.tsx packages/webview/tests/components/DesktopApp.test.tsx packages/webview/tests/components/DesktopSidebar.sessions.test.tsx
git commit -m "feat: keep issues out of the session list"
```

---

### Task 4: 设置页

**Files:**
- Modify: `packages/webview/src/components/dialogs/ConfigDialog.tsx`
- Modify: `packages/webview/src/components/desktop/DesktopShell.tsx`
- Test: `packages/webview/tests/webview/moreMenu.test.tsx`
- Test: `packages/webview/tests/components/iconRail.test.tsx`

**Interfaces:**
- Consumes: `ConfigDialog` 现有 props
- Produces: `ConfigDialog` 增加 `layout?: "dialog" | "page"`，默认 `"dialog"`。`"page"` 时根节点是 `data-testid="desktop-settings-page"`，没有遮罩，铺满中间列。

- [ ] **Step 1: Write the failing test**

点击 `desktop-settings-btn` 后：

- 出现 `desktop-settings-page`
- 设置页里能看到 `ConfigDialog` 现有的一个稳定文案（外观或当前第一个分区标题，用组件里已经渲染的文字，不要新造）
- 不出现对话框遮罩（`queryByTestId` 现有 dialog overlay；若没有 test id，断言页面根不是 `role="dialog"`）
- 右侧没有 `desktop-panel-dock`
- `isAuthenticated` 为 false 时，设置页内有 `desktop-login-btn`，点击调用 `onLogin`

`moreMenu.test.tsx` 改为点击图标栏设置后断言 `desktop-settings-page`，不再断言弹层。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/iconRail.test.tsx tests/webview/moreMenu.test.tsx`

Expected: FAIL，设置仍是空节点或对话框。

- [ ] **Step 3: Write minimal implementation**

`ConfigDialog` 用 `layout` 切换外壳。`"page"` 渲染同一套分区内容，去掉居中弹层和关闭遮罩。关闭按钮在页面模式下不渲染。

`DesktopShell` 在 `shellView === "settings"` 时：

```tsx
<ConfigDialog layout="page" vscode={vscode} {...existingConfigProps} />
```

未登录时在页头放现有登录按钮。不要同时把 `showConfig` 设为 true。非桌面的更多菜单仍用 `layout="dialog"`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/iconRail.test.tsx tests/webview/moreMenu.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/dialogs/ConfigDialog.tsx packages/webview/src/components/desktop/DesktopShell.tsx packages/webview/tests/components/iconRail.test.tsx packages/webview/tests/webview/moreMenu.test.tsx
git commit -m "feat: open desktop settings as a page"
```

---

### Task 5: Muse Bot 标签与空状态

**Files:**
- Create: `packages/webview/src/components/desktop/BotTabs.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Test: `packages/webview/tests/components/botTabs.test.tsx`

**Interfaces:**
- Consumes: `BotWorkspaceState`、`focusTab`、`closeIssueTab`
- Produces: `BotTabs` props `{ state: BotWorkspaceState; titles: Record<string, string>; onFocus: (tab: "bot" | string) => void; onClose: (issueId: string) => void }`

- [ ] **Step 1: Write the failing test**

用一条 Issue 标题渲染 `BotTabs`。断言：

- 有按钮「Muse Bot」，没有关闭按钮
- `openIssueSession` 之后出现该标题，带 `aria-label="关闭"`
- 点标题调用 `onFocus(issueId)`
- 点关闭调用 `onClose(issueId)`，不触发 `onFocus`
- `active === "bot"` 时 Muse Bot 带 `active`；切到 Issue 后只有该标签带 `active`

再测 `ChatApp`：`shellSurface` 为 `"assistant"` 且没有助理消息时，可见「今天想让我帮你做些什么？」。`state.currentSession.id` 变化后，助理框 `assistant-frame` 仍在，视图没有被设回普通聊天。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/botTabs.test.tsx`

Expected: FAIL，组件不存在，或会话 id 变化把助理页清掉。

- [ ] **Step 3: Write minimal implementation**

`BotTabs` 按 `["bot", ...state.openIssueIds]` 渲染。Issue 标签标题过长用省略。关闭按钮 `stopPropagation`。

`ChatApp` 里这段：

```ts
useEffect(() => {
  setView("chat");
}, [state.currentSession?.id]);
```

改成仅在当前不是桌面助理面时重置：

```ts
useEffect(() => {
  if (shellSurface === "assistant") return;
  setView("chat");
}, [state.currentSession?.id, shellSurface]);
```

助理空状态改用与 `WelcomeView` 相同的标志和句子「今天想让我帮你做些什么？」。有消息时仍渲染现有 `AssistantPage` 记录。`BotTabs` 放在 `assistant-frame` 顶部。状态先放在 `DesktopShell`，经 context 传给焦点窗格的 `ChatApp`。context 值是 `BotWorkspaceState` 加四个动作，初始值用 `initialBotWorkspace(host.issueGroups?.[0]?.issueId ?? null)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/botTabs.test.tsx tests/components/assistantSidebarSelection.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/BotTabs.tsx packages/webview/src/components/ChatApp.tsx packages/webview/tests/components/botTabs.test.tsx
git commit -m "feat: add Muse Bot tabs without leaving the assistant"
```

---

### Task 6: 待处理与待办列表

**Files:**
- Create: `packages/webview/src/components/desktop/BotLists.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Test: `packages/webview/tests/components/botLists.test.tsx`

**Interfaces:**
- Consumes: `selectPanel`、`AssistantQueueItem`、`DesktopIssueGroup`
- Produces: `BotLists` props `{ queue: { id: string; kind: string; title: string }[]; issues: { issueId: string; title: string; priority: string }[]; selected: PanelSelection; wide: boolean; menu: "queue" | "todo" | null; onSelect: (panel: Exclude<PanelSelection, { kind: "none" }>) => void; onToggleMenu: (menu: "queue" | "todo") => void }`

- [ ] **Step 1: Write the failing test**

`wide` 为 true：两张卡片「待处理」「待办事项」直接可见。点一条待办，`onSelect` 收到 `{ kind: "issue", issueId }`，卡片仍在，没有新的中间标签。

`wide` 为 false：卡片不在。两个按钮 `aria-label` 为「待处理」「待办」，角标文本是数量。点「待办」后列表出现；再点一项，`onSelect` 同样只带 panel，并且列表收起。

`ChatApp` 在 `window.innerWidth` 为 1400 时 `wide` 为 true，为 1100 时为 false。阈值常量是 `1240`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/botLists.test.tsx`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`BotLists` 在 `wide` 时渲染两张卡片，列宽 268px，顶部对齐，圆角和阴影，不使用遮罩。窄屏时渲染两个图标按钮和弹出层。选中行带 `aria-current="true"`。

队列来自 `AssistantPage` 已经使用的 `listAssistantQueue`。Issue 来自 `host.issueGroups`，不读 `closedIssueGroups`。种类文字用队列项现有类型字段；没有类型时显示「待处理」本身的分类，不发明新枚举。

`ChatApp` 用 `matchMedia("(min-width: 1240px)")` 得到 `wide`，变化时重渲染。卡片只在 `shellSurface === "assistant"` 且中间是标签栏的那一列右侧。会话面不渲染 `BotLists`。

点列表调用 `selectPanel`，不调用 `openIssueSession`，不调用 `onSelectIssue`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/botLists.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/BotLists.tsx packages/webview/src/components/ChatApp.tsx packages/webview/tests/components/botLists.test.tsx
git commit -m "feat: show pending and issue lists beside Muse Bot"
```

---

### Task 7: 右侧详情标签

**Files:**
- Modify: `packages/webview/src/muse/panelTabs.ts`
- Modify: `packages/webview/src/components/desktop/DesktopPanelDock.tsx`
- Create: `packages/webview/src/components/desktop/DockDetail.tsx`
- Test: `packages/webview/tests/components/dockDetail.test.tsx`

**Interfaces:**
- Consumes: `sessionActionLabel`、`DesktopIssueGroup`、队列项
- Produces:
  - `export const DOCK_DETAIL_TAB = "detail" as const`
  - `DockDetail` props：选中项、`actionLabel`、`onOpenSession: (issueId: string) => void`
  - 停靠栏标签 test id：`desktop-panel-tab-detail`。它没有关闭按钮。

- [ ] **Step 1: Write the failing test**

停靠栏第一个标签是「详情」，后面仍是文件、终端、浏览器、变更的原标签。`PANEL_ADD_ORDER` 不含 `detail`。`DesktopPanelKind` 仍是 `"preview" | "diff" | "terminal" | "file"`。

详情在选中 Issue 时显示标题、`状态 · 优先级`、清单每一项。`sessionActionLabel` 为「打开会话」时按钮存在，点击调用 `onOpenSession(issueId)`。标签为 `null` 时按钮不存在。选中待处理时显示类型、标题和正文，没有打开按钮。

从文件标签再调用一次「点列表」后的状态（`dock === "detail"`）时，详情面板可见，文件树不可见。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/dockDetail.test.tsx`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`DesktopPanelDock` 在种类标签之前插入详情按钮。选中它不走 `onSelect(DesktopPanelKind)`，走新的 `onSelectDetail`。详情内容用 `DockDetail` 替换停靠栏主体；其他标签仍渲染现在的窗格。详情按钮不渲染关闭。

`DockDetail` 对 Issue 用 `issueSidebarStatusLabel` 现有文案加优先级。清单用 `items`。按钮文字只用 `sessionActionLabel` 的返回值。

`ChatApp` 把 `state.dock === "detail"` 传给停靠栏。点详情标签调用 `selectDock(state, "detail")`。点文件等标签调用 `selectDock(state, kind)`，不改 `panel`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/dockDetail.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/panelTabs.ts packages/webview/src/components/desktop/DesktopPanelDock.tsx packages/webview/src/components/desktop/DockDetail.tsx packages/webview/src/components/ChatApp.tsx packages/webview/tests/components/dockDetail.test.tsx
git commit -m "feat: add an issue detail tab to the desktop dock"
```

---

### Task 8: 打开 Issue 会话并让工具面板跟随

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/src/components/desktop/DesktopShell.tsx`
- Test: `packages/webview/tests/components/issueTab.test.tsx`

**Interfaces:**
- Consumes: `openIssueSession`、`focusTab`、`DesktopIssueGroup.executionSessionId`、`resolveIssuePlanningSessionId`
- Produces: `export function issueTabSessionId(group: DesktopIssueGroup): string | undefined`，放在 `botWorkspace.ts`。有执行会话 id 就返回它，否则返回 `resolveIssuePlanningSessionId(group)`。

- [ ] **Step 1: Write the failing test**

`issueTabSessionId`：只有规划 id 时返回规划 id；两者都有时返回执行 id。

组件：从详情点「打开会话」后，中间出现该 Issue 标签和 `IssueSessionHeader` 的标题。`onSelectSession` 不被调用。`desktop-sessions-menu` 不变成 `active`。右侧如果当时在「文件」，仍停在文件。

再点另一条待办：中间标签不变，详情换成第二条，`onSelectSession` 仍不被调用。点「切到会话」后中间回到第一条，详情仍是第二条。

选中 Issue 时，传给停靠栏的工作目录是该 Issue 会话的 `workdir`。选中待处理后，工作目录仍是 `lastIssueId` 那条，不是助理目录。在「会话」面点开一条普通会话后，中间是那条会话，停靠栏工作目录仍是 `lastIssueId`，并且没有 `BotTabs`、没有待办卡片。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/issueTab.test.tsx tests/components/botWorkspace.test.ts`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`issueTabSessionId` 按上面的顺序返回。打不开（两个 id 都没有）时详情不显示按钮。

`active !== "bot"` 时，焦点窗格的中间区域渲染现有 `IssueSessionHeader` 和该 `sessionId` 的消息列表。消息用 `museApi.getMessages(sessionId)` 读取。不要 `host.onSelectSession`，不要 `setShellView("sessions")`，不要改传给会话树的 `currentSessionId`。

`shellView === "sessions"` 时，中间仍是被点中的普通会话，不渲染 `BotTabs` 和 `BotLists`。这一面的停靠栏工作目录同样用下面的 `dockWorkdir`，不用普通会话自己的目录。这样从 Muse Bot 点进「会话」之后，右侧还是刚才选中的 Issue。

停靠栏工作目录：

```ts
const dockIssueId =
  state.panel.kind === "issue" ? state.panel.issueId : state.lastIssueId;
const dockWorkdir = dockIssueId
  ? issueGroupSessionWorkdir(group, issueTabSessionId(group), host.workdir)
  : assistantWorkdir;
```

`panelWorkdir` 在助理面用 `dockWorkdir`。这样文件、终端、浏览器、变更跟着列表选中的 Issue，而中间标签可以是另一条。

从会话、自动化、设置回到 Muse Bot 时保留同一份 `BotWorkspaceState`，不重新 `initialBotWorkspace`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/issueTab.test.tsx tests/components/botWorkspace.test.ts tests/components/botLists.test.tsx tests/components/dockDetail.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/desktop/botWorkspace.ts packages/webview/src/components/ChatApp.tsx packages/webview/src/components/desktop/DesktopShell.tsx packages/webview/tests/components/issueTab.test.tsx packages/webview/tests/components/botWorkspace.test.ts
git commit -m "feat: open issue sessions from the detail tab only"
```

---

### Task 9: 收口现有测试

**Files:**
- Modify: `packages/webview/tests/components/assistantSidebarSelection.test.tsx`
- Modify: `packages/webview/tests/components/automationsPage.test.tsx`
- Modify: `packages/webview/tests/webview/streamingButtonStates.test.tsx`
- Modify: `packages/webview/tests/webview/sessionManagement.test.tsx`
- Modify: `packages/webview/tests/webview/tooltip.test.tsx`
- Modify: `packages/webview/tests/webview/clearChat.test.tsx`
- Modify: `packages/webview/e2e/demo/desktop-app.demo.ts`（设置按钮改为先看到设置页）

**Interfaces:**
- Consumes: Task 2 到 Task 4 的 test id
- Produces: 无

- [ ] **Step 1: Run the webview unit tests**

Run: `pnpm --filter @muse-work/webview test`

Expected: 失败的用例只来自旧侧栏假设：首屏就要 `desktop-new-session`、首屏 Issue 区、设置打开对话框、助理菜单不是默认选中。

- [ ] **Step 2: Update the assertions**

- 要「新对话」的用例先点 `desktop-sessions-menu`。
- 助理选中态改为首屏就已经 `active`；再点「会话」后失去 `active`，点回来恢复。
- 自动化用例从 Muse Bot 点 `desktop-automations-menu`，断言自动化页出现且没有停靠栏。
- 设置用例断言 `desktop-settings-page`。
- 工具提示用例改读图标按钮的 `aria-label`（Muse Bot、会话、自动化、设置）。

不放宽 Issue 不在会话列表里的断言。

- [ ] **Step 3: Re-run**

Run: `pnpm --filter @muse-work/webview test`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/webview/tests packages/webview/e2e/demo/desktop-app.demo.ts
git commit -m "test: align desktop tests with the icon rail"
```
