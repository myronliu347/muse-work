# Desktop-only Webview（移除 VSCE/JetBrains 场景）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 webview 中所有 VSCE/JetBrains 非 desktop 行为分支与死代码，使代码只有 desktop 一条路径，同时保留宿主通道与类型机制。

**Architecture:** 保留 `acquireVsCodeApi` 通道、hostBridge outer 镜像、`waveHostType`/`host.type` 类型声明（desktop IPC 依赖）；删除所有 `!isDesktop` / `waveHostType !== "desktop"` 行为分支，删除分支后失去意义的 `isDesktop` 判断一并删除。桌面布局、面板、paneId 多 pane 机制全部保留。

**Tech Stack:** TypeScript / React / vitest / jsdom

**Spec:** `docs/superpowers/specs/2026-08-16-desktop-only-webview-design.md`

## Global Constraints

- 只删除非 desktop 行为与死代码，不改变 desktop 现有行为，不做无关重构。
- `acquireVsCodeApi` 通道、hostBridge outer 镜像、`waveHostType`/`host.type` 类型声明、`VsCodeApi` 类型保留。
- 每个任务完成后跑相关 vitest 用例确认绿；全部完成后跑 webview 全量 + desktop type-check。
- 提交信息遵循仓库风格（`feat|fix|refactor|test|docs(scope): 描述`）。

---

### Task 1: 删除 SessionListPopup 整组

**Files:**
- Delete: `packages/webview/src/components/dialogs/SessionListPopup.tsx`
- Delete: `packages/webview/src/styles/SessionListPopup.css`
- Delete: `packages/webview/src/components/session/SessionList.tsx`
- Modify: `packages/webview/src/components/chat/ChatHeader.tsx`
- Modify: `packages/webview/src/types/index.ts:573-593`（ChatHeaderProps）
- Modify: `packages/webview/src/components/ChatApp.tsx:2438-2441`
- Test: `packages/webview/tests/webview/sessionManagement.test.tsx`、`packages/webview/tests/webview/taskListToggle.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `ChatHeaderProps` 不再含 `sessions`/`currentSession`/`onSessionSelect`/`sessionsLoading`；`ChatHeader` 不再渲染"历史对话"按钮与 `session-list-popup`。

- [ ] **Step 1: 删除组件与样式文件**

```bash
git rm packages/webview/src/components/dialogs/SessionListPopup.tsx
git rm packages/webview/src/styles/SessionListPopup.css
git rm packages/webview/src/components/session/SessionList.tsx
```

- [ ] **Step 2: 清理 ChatHeader.tsx**

删除：`HistoryIcon` import（第 3 行中 `HistoryIcon,`）、`SessionListPopup` import（第 4 行）、`sessions`/`currentSession`/`onSessionSelect`/`sessionsLoading` 解构（第 16-19 行）、`showSessionList` state（第 29 行）、`history-btn` 按钮块（第 57-66 行，`<Tooltip text="历史对话">...</Tooltip>`）、`showSessionList && <SessionListPopup ...>` 渲染块（第 83-91 行）。

- [ ] **Step 3: 清理 ChatHeaderProps 类型（types/index.ts）**

删除 `ChatHeaderProps` 中的 `sessions: SessionMetadata[];`（578）、`currentSession?: SessionMetadata;`（579）、`onSessionSelect: (sessionId: string) => void;`（580）、`sessionsLoading: boolean;`（581）。

- [ ] **Step 4: 清理 ChatApp.tsx 传入的 props**

删除 ChatApp.tsx:2438-2441 的 `sessions={state.sessions}`、`currentSession={state.currentSession}`、`onSessionSelect={handleSessionSelect}`、`sessionsLoading={state.sessionsLoading}` 四行（ChatHeader 调用处）。若 `handleSessionSelect` 因此不再被引用，一并删除其定义。

- [ ] **Step 5: 删除测试中的 SessionListPopup 用例**

`sessionManagement.test.tsx`：删除 `openSessionListPopup` helper（第 18-23 行）与所有调用它的用例（含 `session-list-popup` / `session-list-search` / `session-list-item-*` 断言）。删除后如文件只剩无关用例则保留其余部分。
`taskListToggle.test.tsx`：删除第 314-317 行使用 `history-btn`/`session-list-item-session-b` 的用例。

- [ ] **Step 6: 运行相关测试**

Run: `cd packages/webview && npx vitest run tests/webview/sessionManagement.test.tsx tests/webview/taskListToggle.test.tsx`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add -A packages/webview/src packages/webview/tests
git commit -m "refactor(webview): remove dead SessionListPopup (desktop hides its trigger)"
```

---

### Task 2: 根入口只渲染 DesktopApp + ChatApp 主布局收敛

**Files:**
- Modify: `packages/webview/src/index.tsx:56-63`
- Modify: `packages/webview/src/components/ChatApp.tsx:2483-2530`（主布局 JSX 分支）

**Interfaces:**
- Consumes: 无
- Produces: `index.tsx` 直接渲染 `<DesktopApp vscode={vscode} />`；ChatApp 主渲染只有 `.desktop-chat-body` 布局。

- [ ] **Step 1: index.tsx 删除分流 else 分支**

将第 56-63 行改为：

```tsx
root.render(
  <MuseTheme>
    <DesktopApp vscode={vscode} />
  </MuseTheme>,
);
```

删除 `ChatApp` import（第 4 行，若 ChatApp 仍被 index.tsx 引用则保留）。

- [ ] **Step 2: ChatApp 主布局分支收敛**

找到 `:2483` 的 `{isDesktop ? (<div className="desktop-chat-body"> ... ) : (...)}` 分支。删除 `else` 分支（非 desktop 布局），将三元替换为直接返回 `<div className="desktop-chat-body">...</div>` 内容。

- [ ] **Step 3: 运行 webview 全量测试**

Run: `cd packages/webview && npx vitest run`
Expected: 全部通过（当前 755 用例基线，删除用例后略少）。

- [ ] **Step 4: Commit**

```bash
git add packages/webview/src/index.tsx packages/webview/src/components/ChatApp.tsx
git commit -m "refactor(webview): render DesktopApp unconditionally at root"
```

---

### Task 3: ChatApp isDesktop 收敛（交互与文件 handler）

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
  - `:802-813` triggerShortcut case
  - `:1797-1846` 面板快捷键 `if (!isDesktop) return`
  - `:1855-1889` handleOpenFile
  - `:1904` handleRevealInFinder
- Test: 现有 desktop 用例（`tests/webview/*`）

**Interfaces:**
- Consumes: 无
- Produces: `handleOpenFile` 恒走文件面板；`triggerShortcut` case 不再存在；面板快捷键恒绑定。

- [ ] **Step 1: 删除 triggerShortcut case**

删除 `:802-813` 的 `case "triggerShortcut":` 整块（含 JetBrains AnAction 注释）。

- [ ] **Step 2: 删除面板快捷键 guard**

`:1797-1846` 整段以 `if (!isDesktop) return;` 开头——删除该 guard 行与其依赖数组中 `isDesktop`（:1840）。确认段内其他代码保留。

- [ ] **Step 3: 收敛 handleOpenFile**

`:1855-1889`：删除 `if (!isDesktop) { vscode.postMessage({ command: "openFile", path, startLine, endLine }); return; }` 分支（1858-1861）与其上方的 IDE 注释（1853-1854）。删除后 `isDesktop` 从依赖数组移除（:1892）。确认 `vscode` 仍被其他代码使用，否则从依赖移除。

- [ ] **Step 4: 收敛 handleRevealInFinder**

`:1904`：`if (!isDesktop || !path) return;` → `if (!path) return;`，依赖数组移除 `isDesktop`（:1907）。

- [ ] **Step 5: 运行相关测试**

Run: `cd packages/webview && npx vitest run tests/webview/readToolOpenFile.test.tsx tests/webview/desktopGitContext.test.tsx tests/webview/sessionHeaderGitBranch.test.tsx 2>/dev/null || npx vitest run tests/webview/readToolOpenFile.test.tsx`
Expected: 通过（若某文件不存在则跳过）。

- [ ] **Step 6: 运行 webview 全量测试**

Run: `cd packages/webview && npx vitest run`
Expected: 全部通过。

- [ ] **Step 7: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx
git commit -m "refactor(webview): drop IDE branches from open-file and shortcut handlers"
```

---

### Task 4: ChatApp isDesktop 收敛（布局与面板）

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
  - `:178` `isDesktop` 定义（若全部使用点移除则删除；否则保留）
  - `:182` `gitBranches`、`:187-193` headerGitContext
  - `:199-201` panelWorkdir/groupKey
  - `:295-309` ResizeObserver、`:1643-1648` xterm 预取
  - `:990-1002`、`:1012-1030` git branches 请求
  - `:2014-2017` panelDisabled、`:2026-2028` desktopPanelState、`:2035-2049` dock clamp
  - `:2127` showNewSessionPage、`:2154` enableLocalFilePick、`:2277` input class、`:2419` QuickOpenPalette、`:2446-2447` hideSessionButtons/hideMoreButton、`:2450` dock 空态、`:2465` chatContainerRef、`:2365` StatusDialog 传参
  - `:263-265`、`:344-352`、`:957-968` paneId IDE 注释

**Interfaces:**
- Consumes: Task 1（ChatHeader props）、Task 2（主布局）
- Produces: `isDesktop` 相关条件全部收敛为 desktop 行为

- [ ] **Step 1: 收敛各 isDesktop 条件（按下列逐一处理）**

对每处条件，删除"非 desktop 时"的路径，保留 desktop 行为；若条件只剩一个值则直接删除条件：
- `:182` `gitBranches = isDesktop ? paneGitBranches : null` → `gitBranches = paneGitBranches`
- `:187-193` `isDesktop && !isDraftSession ? {...} : undefined` → `!isDraftSession ? {...} : undefined`
- `:199-201` `isDesktop ? host?.workdir : undefined` 与 `isDesktop && panelWorkdir ? panelWorkdir : undefined` → 去掉 `isDesktop` 项
- `:295` `if (!isDesktop) return;` 删除；`:309` 依赖数组移除 `isDesktop`
- `:990`、`:1012`、`:1643`、`:2014`、`:2026`、`:2035` 的 `if (!isDesktop) return;` 全部删除，依赖数组移除 `isDesktop`
- `:2127` `showNewSessionPage = isDesktop && isDraftSession && state.initialized` → 去掉 `isDesktop`
- `:2154` `enableLocalFilePick={isDesktop}` → `enableLocalFilePick={true}`
- `:2277` `isDesktop && state.pendingConfirmations.length > 0` → 去掉 `isDesktop`
- `:2419` `{isDesktop && (<QuickOpenPalette ... />)}` → 直接渲染
- `:2446-2447` `hideSessionButtons={isDesktop}`/`hideMoreButton={isDesktop}` → `hideSessionButtons`/`hideMoreButton` 传 `{true}`
- `:2450` `isDesktop && checkedPanels.length === 0` → 去掉 `isDesktop`
- `:2465` `ref={isDesktop ? chatContainerRef : undefined}` → `ref={chatContainerRef}`
- `:2365` StatusDialog `isDesktop={isDesktop}` 删除该 prop（配合 Task 6）
- `:263-265`、`:344-352`、`:957-968` 注释与分支中 "IDE hosts" 表述删除/改写

- [ ] **Step 2: 处理 isDesktop 定义与 StatusDialog prop**

若 `:178` 的 `isDesktop` 已无任何引用，删除定义与 `host` 相关；否则保留。`StatusDialog` 的 `isDesktop` prop 在 Task 6 一并处理（本步先删除 ChatApp 传参，若 type 检查报错则同步 Task 6 内容）。

- [ ] **Step 3: 运行 webview 全量测试**

Run: `cd packages/webview && npx vitest run`
Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx
git commit -m "refactor(webview): fold isDesktop conditions to desktop-only behavior"
```

---

### Task 5: Message.tsx 链接与 openFile 收敛

**Files:**
- Modify: `packages/webview/src/components/message/Message.tsx:176-192`、`:269-283`
- Test: `packages/webview/tests/webview/messageLinkRouting.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `Message` 内 `openFile` 恒走 `props.onOpenFile`（无 vscode.postMessage fallback）；链接点击恒被拦截（localhost→onOpenPreview，其余→openExternal）。

- [ ] **Step 1: 删除 openFile 的 IDE fallback**

`:176-192`：删除 `else { props.vscode.postMessage({ command: "openFile", path, startLine, endLine }); }` 分支及 IDE 注释（177-180），`openFile` 只剩 `if (props.onOpenFile) { props.onOpenFile(...) }`。若 `props.vscode` 在文件内仍被使用则保留 prop。

- [ ] **Step 2: 删除 handleContentClick 的 IDE return**

`:269-283`：删除 `if (window.waveHostType !== "desktop") return;` 与注释（269-271），保留 `e.preventDefault()` 起的 desktop 路由逻辑。

- [ ] **Step 3: 删除 messageLinkRouting 的 IDE 用例**

删除 `tests/webview/messageLinkRouting.test.tsx:91-107` 的 `"IDE host: links are not intercepted at all"` 用例；更新文件头注释（8-10 行）去掉 "IDE hosts must keep their native link handling"。`renderMessage` 的 `hostType` 参数与 `afterEach` 保留（desktop 用例仍用）。

- [ ] **Step 4: 运行测试**

Run: `cd packages/webview && npx vitest run tests/webview/messageLinkRouting.test.tsx`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/message/Message.tsx packages/webview/tests/webview/messageLinkRouting.test.tsx
git commit -m "refactor(webview): route message links as desktop-only"
```

---

### Task 6: StatusDialog / MoreMenu / MessageInput 收敛

**Files:**
- Modify: `packages/webview/src/components/dialogs/StatusDialog.tsx`（`isDesktop?: boolean` prop，:15）
- Modify: `packages/webview/src/components/shared/MoreMenu.tsx`（hostLabel 标注与注释，:10-16、:70、:78、:86）
- Modify: `packages/webview/src/components/chat/MessageInput.tsx`（:1453-1476、:959 注释）

**Interfaces:**
- Consumes: Task 4（ChatApp 已移除 StatusDialog isDesktop 传参）
- Produces: `StatusDialog` 无 `isDesktop` prop；`MoreMenu` 登录/退出/设置项恒显示（无 hostLabel 条件）；`MessageInput` 工具栏恒显示"添加文件"按钮。

- [ ] **Step 1: StatusDialog 删除 isDesktop prop**

删除 `StatusDialogProps` 中 `isDesktop?: boolean`（:15）及组件内对该 prop 的所有使用（若只用于条件 class，收敛为 desktop 行为）。

- [ ] **Step 2: MoreMenu 简化 hostLabel**

删除 `MoreMenuProps.hostLabel`（:10-16，含 VSCE/JetBrains 注释）与 `:70`/`:78`/`:86` 的 `{hostLabel ? `（${hostLabel}）` : ""}` 三元，直接显示 `设置` / `退出登录` / `登录`。删除 `hostLabel` 解构（:25）。检查 ChatApp/ChatHeader 是否传 `hostLabel`（当前无传入，若有则一并删除）。

- [ ] **Step 3: MessageInput 收敛 enableLocalFilePick**

`:1453-1476`：`{enableLocalFilePick || workdirSelector ? (...)}` 收敛为直接渲染 `input-toolbar-left`（`enableLocalFilePick` 恒 true）；`{enableLocalFilePick ? (<button ...添加文件...>) : null}` 收敛为直接渲染按钮。`:959` 注释中 "e.g. VS Code's" 表述删除。删除 `enableLocalFilePick` prop 后检查 ChatApp 调用处（Task 4 已改 `enableLocalFilePick={true}`，若 prop 已删除则同步删除传参）。

- [ ] **Step 4: 运行 webview 全量测试**

Run: `cd packages/webview && npx vitest run`
Expected: 全部通过（若 `enableLocalFilePick`/`isDesktop` 删除引发类型错误，按报错同步清理调用处）。

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src
git commit -m "refactor(webview): simplify StatusDialog/MoreMenu/MessageInput to desktop-only"
```

---

### Task 7: 主题层 IDE 分支收敛

**Files:**
- Modify: `packages/webview/src/ui/themePreference.ts:39-41`、`:73`、`:286-294`
- Modify: `packages/webview/src/utils/theme.ts:1-24`（文档注释）
- Test: `packages/webview/tests/muse/themePreference.test.ts`、`packages/webview/tests/muse/theme.test.tsx`、`packages/webview/tests/webview/mermaidTheme.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `detectSystemDark` 仅信任 vscode body class 或系统 `prefers-color-scheme`；主题持久化推送恒走 desktop 分支。

- [ ] **Step 1: 收敛 detectSystemDark**

`:39-41` 删除：

```ts
if (typeof window !== "undefined" && window.waveHostType !== "desktop") {
  return isDarkTheme();
}
```

- [ ] **Step 2: 收敛 MutationObserver 与推送条件**

`:73` `window.waveHostType === "desktop" &&` 删除该条件（恒 desktop，保留 mutations 判断逻辑）。`:286-294` 若条件含 `window.waveHostType === "desktop"`，删除该条件项。

- [ ] **Step 3: 更新 theme.ts 文档注释**

`utils/theme.ts:1-24`：将三宿主暗色机制说明精简为 desktop 机制（`<html data-theme>` + vscode body class 说明可保留，删除 JetBrains 相关）。

- [ ] **Step 4: 删除主题测试的 IDE 用例**

`themePreference.test.ts`、`theme.test.tsx`、`mermaidTheme.test.tsx`：删除 `waveHostType` 非 desktop / "JetBrains hosts" 相关用例与 `delete window.waveHostType` 分支（保留 desktop 用例）。`mermaidTheme.test.tsx:47` 的 "desktop/JetBrains hosts" 描述改为 desktop。

- [ ] **Step 5: 运行测试**

Run: `cd packages/webview && npx vitest run tests/muse/themePreference.test.ts tests/muse/theme.test.tsx tests/webview/mermaidTheme.test.tsx`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add packages/webview/src/ui/themePreference.ts packages/webview/src/utils/theme.ts packages/webview/tests
git commit -m "refactor(webview): make theme detection desktop-only"
```

---

### Task 8: 注释清理与最终验证

**Files:**
- Modify（仅注释）: `packages/webview/src/reducers/chatReducer.ts:498`、`packages/webview/src/types/index.ts`（:110-140、:159、:338、:483；:713 只改注释）、`packages/webview/src/components/ChatApp.tsx:92`、`:1951`、`packages/webview/src/terminal-entry.ts:4`、`packages/webview/esbuild.config.mjs:29`、`packages/webview/scripts/syncTargets.mjs:5`
- Modify（CSS 注释，可选）: `packages/webview/src/styles/DesktopApp.css:1091`、`ToastStack.css:1-2`、`FilePane.css:138`
- Test: `packages/webview/tests/webview/bangCommand.test.tsx:178`、`packages/webview/tests/webview/backgroundTasksInitState.test.tsx:21`（注释）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 代码中无 VSCE/JetBrains/IDE-host 场景表述（机制性引用除外）

- [ ] **Step 1: 清理各注释**

将各文件中提及 VSCE/JetBrains/IDE host 的注释改写为 desktop 语境（如 `chatReducer.ts:498` 改为 "desktop 宿主增量投递用户消息…"；`types/index.ts` 的 "VSCE/JetBrains hosts never render these" → "Desktop-only panels"）。`types/index.ts:713` "Maps to VS Code global state" 保留（机制说明），仅去掉误导性表述。

- [ ] **Step 2: 确认无残留**

Run: `cd packages/webview && grep -rn "VSCE\|JetBrains" src tests | grep -v node_modules`
Expected: 仅剩机制性引用（如 `acquireVsCodeApi` 相关注释、`ConfirmationDialog` 的 "VS Code theme variables" 风格说明），无场景分支描述。

- [ ] **Step 3: 全量验证**

Run: `cd packages/webview && npx vitest run`
Expected: 全部通过。

Run: `cd packages/desktop && npx tsc --noEmit -p tsconfig.json`
Expected: 无错误（或仅剩与本任务无关的已知错误）。

- [ ] **Step 4: Commit**

```bash
git add packages/webview
git commit -m "docs(webview): scrub VSCE/JetBrains references after desktop-only refactor"
```

---

## 验证总览

- `cd packages/webview && npx vitest run` — 每任务后跑，最终全绿。
- `cd packages/desktop && npx tsc --noEmit -p tsconfig.json` — Task 8 验证。
- 手工冒烟（可选）：`pnpm dev:desktop` 打开 README，确认文件面板 markdown 图片/链接、侧边栏 workdir 右键菜单行为不变。
