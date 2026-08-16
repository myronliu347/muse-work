# 移除 webview 中 VSCE/JetBrains 场景代码（Desktop-only）设计规格

**日期**：2026-08-16
**状态**：已评审（对话确认范围与处理原则）
**产品**：Muse Work

## 1. 背景与目标

webview fork 自 Wave，保留了对多宿主（Electron desktop、VS Code 扩展 VSCE、JetBrains）的分支处理：`waveHostType === "desktop"` 分流根组件，组件内以 `isDesktop`（`host?.type === "desktop"`）区分行为。产品目前只以 desktop 形态交付，VSCE/JetBrains 路径不会被执行。

目标：删除所有非 desktop 行为分支与仅服务 IDE 宿主的组件，使代码只有 desktop 一条路径。**保留宿主通道与类型机制**（`acquireVsCodeApi` 通道、`waveHostType`/`host.type` 类型定义、hostBridge outer 镜像），因为 desktop 自身的 IPC 依赖这些实现。

## 2. 处理原则

1. **删除行为，保留机制**：删除所有 `!isDesktop` / `waveHostType !== "desktop"` 分支中的 IDE 行为代码；`isDesktop` 判断在删除分支后失去意义的一并删除。
2. **保留 desktop 依赖**：`acquireVsCodeApi` 通道、hostBridge outer 镜像、`waveHostType`/`host.type` 类型声明、`VsCodeApi` 类型、vscode 主题变量引用（desktop webview 本身用）。
3. **不改功能**：本次只做删除与收敛，不改变 desktop 现有行为；不做无关重构。
4. **测试同步**：删除 IDE 场景用例，保留全部 desktop 用例作为回归保障。

## 3. 删除清单

### 3.1 根入口

- `packages/webview/src/index.tsx`：删除 `waveHostType === "desktop" ? <DesktopApp/> : <ChatApp/>` 的 else 分支，直接渲染 `<DesktopApp vscode={vscode} />`。

### 3.2 ChatApp.tsx（isDesktop 全量收敛，约 20 处）

- `:2483` 主布局 JSX 分支（`isDesktop ? <desktop-chat-body> : <非 desktop 布局>`）——收敛为 desktop 布局。
- `:295-309` chat 列宽 ResizeObserver 绑定 `if (!isDesktop) return`。
- `:990-1002`、`:1012-1030` git branches 请求与 workdir 变更清理的 `!isDesktop` guard。
- `:2014-2017` `panelDisabled` 的 `if (!isDesktop) return []`。
- `:2026-2028` desktopPanelState 上报、`:2035-2049` dock 宽度 clamp 的 `!isDesktop` guard。
- `:2127` `showNewSessionPage` 收敛（`isDesktop && isDraftSession && state.initialized` → 去掉 `isDesktop`）。
- `:2277` input 确认态 class、`:2419` QuickOpenPalette 条件、`:2450` dock 空态、`:2465` chatContainerRef。
- `:1855-1889` `handleOpenFile` 删除 `!isDesktop` 的 IDE RPC 分支（`vscode.postMessage({command:"openFile"})`），只留进面板路径。
- `:1904` `handleRevealInFinder` 的 `!isDesktop` guard。
- `:802-813` JetBrains `triggerShortcut`（AnAction 转发）路径。
- `:1797-1846` 桌面面板快捷键 `if (!isDesktop) return` guard。
- `:2446-2447` `hideSessionButtons`/`hideMoreButton` 收敛为 true。
- `:2154` `enableLocalFilePick` 收敛为 true。
- `:263-265`、`:344-352`、`:957-968` paneId 为 undefined 时标注 "IDE hosts" 的注释与分支。
- `:2365` StatusDialog 的 `isDesktop` 传参。
- `:92`、`:1951` 提及 VS Code/IDE hosts 的注释。

### 3.3 其他组件

- `StatusDialog.tsx`：删除 `isDesktop?: boolean` prop 及相关条件。
- `Message.tsx`：删除 `openFile` 的 IDE fallback（`:176-192`，`props.vscode.postMessage({command:"openFile"})` 兜底）；删除 `handleContentClick` 的 `waveHostType !== "desktop"` return（`:269-283`，IDE 原生链接处理）。
- `MoreMenu.tsx`：删除 hostLabel "Absent for hosts without the concept (VSCE/JetBrains)" 的 IDE 分支。
- `MessageInput.tsx`：删除 `enableLocalFilePick` 非 desktop 路径（添加文件按钮的 IDE 侧）；`:959` Ctrl+B 注释中 VS Code 表述。
- `themePreference.ts`：删除 `:39-41` 非 desktop 直接信任宿主 `isDarkTheme()` 的分支；`:286-294` 主题持久化推送仅 desktop 的 guard 收敛；`:73` 相关条件。
- `utils/theme.ts`：暗色机制文档精简为 desktop 单一机制。

### 3.4 SessionListPopup 整组删除

`SessionListPopup` 是 ChatHeader 头部"历史对话"按钮弹出的会话切换弹层（搜索 + 切换）。desktop 下触发按钮被 `hideSessionButtons` 隐藏，为死代码。依赖链已验证：`SessionList` 仅被 `SessionListPopup` 使用，`SessionListPopup` 仅被 `ChatHeader` 使用。

- 删除 `components/dialogs/SessionListPopup.tsx`、`styles/SessionListPopup.css`、`components/session/SessionList.tsx`。
- `ChatHeader.tsx`：删除"历史对话"按钮、`showSessionList` 状态、`SessionListPopup` 渲染及其 props（`sessions`/`onSessionSelect`/`sessionsLoading`/`currentSession`）。
- `ChatApp.tsx`：渲染 `ChatHeader` 处的对应 props（`sessions`/`onSessionSelect`/`sessionsLoading` 等）同步删除。

### 3.5 注释清理

- `reducers/chatReducer.ts:498` 提及 VSCE 的注释。
- `types/index.ts`：`:110-140` "VS Code API type"、`:159` IDE hosts、`:338`、`:483` 注释；`:713` "Maps to VS Code global state" 只改注释不动代码。
- `terminal-entry.ts`、`esbuild.config.mjs:29`、`scripts/syncTargets.mjs` 的 VSCE/JetBrains 注释（syncTargets 已是 no-op，保留行为）。
- 各 CSS 文件（`DesktopApp.css:1091`、`ToastStack.css`、`FilePane.css`）提及 VSCE/JB 的注释。

### 3.6 测试

- 删除 `sessionManagement.test.tsx` 中 SessionListPopup 相关用例。
- 删除 `taskListToggle.test.tsx` 中使用 `history-btn`/`session-list-item` 的用例。
- `messageLinkRouting.test.tsx`：删除非 desktop 用例，保留 desktop 用例。
- `theme.test.tsx`、`themePreference.test.ts`、`mermaidTheme.test.tsx`：删除 IDE 用例。
- `panelWorkdirScope.test.tsx`、`previewPane.test.tsx`：删除 `delete window.waveHostType` 相关分支。
- `bangCommand.test.tsx:178`、`backgroundTasksInitState.test.tsx:21`：注释更新。

## 4. 保留项

- `acquireVsCodeApi` 通道与 `index.tsx` 的 outer 注入逻辑（desktop preload 提供）。
- hostBridge 的 outer 镜像转发（`hostBridge.ts:1744-1749`，desktop IPC 与测试依赖）。
- `waveHostType`/`host.type` 类型声明与 `isDesktop` 判定表达式（保留抽象层）。
- `DesktopApp`/`ChatApp` 组件结构、paneId 多 pane 机制（desktop 自身功能）。
- desktop 面板命令（openFile→面板、revealInFinder、desktop* 系列）与桌面面板组件（DiffPane/FileTree/PreviewPane/TerminalPane 等）。
- vscode 主题变量引用（`ConfirmationDialog.tsx:24` 等，desktop webview 使用）。

## 5. 验证

- `packages/webview`：全量 vitest 通过（删除 IDE 用例后）。
- `packages/desktop`：type-check 与测试通过（注意 `SenderCat.tsx` 预先存在的类型错误与本任务无关）。
- `pnpm dev:desktop` 冷启动冒烟：侧边栏/面板/文件打开/链接路由行为不变。

## 6. 非目标

- 不删除宿主类型抽象（`waveHostType`/`isDesktop`/`host.type`）——未来可低成本加回 IDE 宿主。
- 不简化 desktop 自身的 paneId 多 pane 机制。
- 不重构 hostBridge 命令分发。
- 不处理 desktop 包（Electron 壳本身只有 desktop 场景）。
