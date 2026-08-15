# Webview Zustand 状态管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@muse-work/webview` 引入 Zustand，将除 `chatReducer` 外的 UI/布局状态迁入三个 store，行为与现有测试保持一致。

**Architecture:** 三个全局 singleton store（`desktopStore`、`panelGroupStore`、`paneUiStore`）按窗口 / session / pane 三层隔离。`ChatApp` 保留 `useReducer(chatReducer)`；面板状态从「useState + Map 双写」改为 store 直读直写；稳定 message listener 继续用 ref + `getState()`。

**Tech Stack:** pnpm monorepo、React 18、Zustand `^5.x`、Vitest + Testing Library、esbuild IIFE

**Spec:** `docs/superpowers/specs/2026-08-15-webview-zustand-design.md`

## Global Constraints

- **不迁移** `chatReducer` 及任何 `dispatch` 路径
- Zustand `^5.x`，仅 `packages/webview` 依赖
- 无 persist / devtools / immer middleware
- `prunePanelGroupCache` 保留为 public API（re-export 别名）
- `ChatAppProps` 与 `host` prop 形状不变
- 包管理器：pnpm；验证：`pnpm -F @muse-work/webview type-check` + `test`

## File Structure

```text
packages/webview/package.json                         # + zustand
packages/webview/src/stores/paneKey.ts                # paneStoreKey()
packages/webview/src/stores/desktopStore.ts
packages/webview/src/stores/panelGroupStore.ts
packages/webview/src/stores/paneUiStore.ts
packages/webview/src/stores/index.ts                  # resetWebviewStores()
packages/webview/src/components/DesktopApp.tsx        # use desktopStore
packages/webview/src/components/ChatApp.tsx           # use panelGroup + paneUi stores
packages/webview/tests/webview/chatAppPanels.test.tsx # resetWebviewStores in beforeEach
```

---

### Task 1: 依赖与 store 骨架

**Files:**
- Modify: `packages/webview/package.json`
- Create: `packages/webview/src/stores/paneKey.ts`
- Create: `packages/webview/src/stores/desktopStore.ts`
- Create: `packages/webview/src/stores/panelGroupStore.ts`
- Create: `packages/webview/src/stores/paneUiStore.ts`
- Create: `packages/webview/src/stores/index.ts`

**Interfaces — Produces:**
- `paneStoreKey(paneId?: string): string`
- `useDesktopStore` with `setWorkdirState`, `setSessionTree`, `setPanes`, `reset`
- `usePanelGroupStore` with `patchGroup`, `migrateGroup`, `pruneGroups`, `findGroupKeyByForwardRequestId`, `bumpPreviewEpoch`, `resolvePanelGroup`, `prunePanelGroupCache`
- `usePaneUi(paneId?)`, `patchPaneUi(paneId?, patch)`
- `resetWebviewStores(): void`

- [ ] **Step 1:** `pnpm add zustand` in `packages/webview`
- [ ] **Step 2:** 创建上述 store 文件（完整类型与 actions，见 spec §4）
- [ ] **Step 3:** `pnpm -F @muse-work/webview type-check`

---

### Task 2: 迁移 DesktopApp

**Files:**
- Modify: `packages/webview/src/components/DesktopApp.tsx`

- [ ] **Step 1:** 用 `useDesktopStore` 替换 5 个 `useState`
- [ ] **Step 2:** message handler 调用 store actions；`prunePanelGroupCache` 改从 `stores` import
- [ ] **Step 3:** `pnpm -F @muse-work/webview test -- tests/components/DesktopSidebar`

---

### Task 3: 迁移 panelGroupStore（ChatApp 面板）

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`

- [ ] **Step 1:** 删除 `panelGroupCache`、`PanelGroupState` 本地定义；re-export `prunePanelGroupCache`
- [ ] **Step 2:** 面板相关 `useState` → `usePanelGroupStore` selector + `updatePanelGroup`
- [ ] **Step 3:** 删除 sync effect 与 groupKey bulk setState effect；保留 `migrateGroup` effect
- [ ] **Step 4:** message handler 中 `desktopForwardPortResult` / `desktopFileContent` 改用 store
- [ ] **Step 5:** `tryOpenPanel` / `handleTogglePanel` / preview / file / forward 改用 store
- [ ] **Step 6:** `pnpm -F @muse-work/webview test -- tests/webview/chatAppPanels.test.tsx`

---

### Task 4: 迁移 paneUiStore（ChatApp 弹层 UI）

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/tests/webview/chatAppPanels.test.tsx`（及使用 `prunePanelGroupCache` 的测试 setup）

- [ ] **Step 1:** 剩余 `useState` → `usePaneUi` + `patchPane` / `patchPaneUi`
- [ ] **Step 2:** message handler 中 toast / rewind / model / btw / git branches 分支改用 store
- [ ] **Step 3:** JSX props（`onBranchChange` 等）改为 patch 回调
- [ ] **Step 4:** 测试 `beforeEach` 改用 `resetWebviewStores()`
- [ ] **Step 5:** 全量 `pnpm -F @muse-work/webview type-check && pnpm -F @muse-work/webview test`

---

### Task 5: 验收

- [ ] `ChatApp.tsx` 无面板/popup 相关 `useState`（仅保留 `useReducer`）
- [ ] 无模块级 `panelGroupCache`
- [ ] spec §11 四项验收标准满足
