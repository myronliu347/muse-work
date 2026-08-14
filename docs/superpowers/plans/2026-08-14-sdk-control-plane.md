# SDK 控制面接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 compact/clear/rewind、acceptEdits↔bypass、MCP、token、Task 列表、后台 Agent、Workflow 接到现有 webview。

**Architecture:** HTTP 控制面 + WS 事件经 hostBridge 翻译成已有 webview command。`sessionRunner` 包装 SDK Agent 方法与回调。斜杠菜单固定 7 条系统命令，发送时拦截。

**Tech Stack:** TypeScript、Node http、wave-agent-sdk 1.0.7、React 18、Vitest

**Spec:** `docs/superpowers/specs/2026-08-14-sdk-control-plane-design.md`

## Global Constraints

- 权限仅 `acceptEdits` | `bypassPermissions`；默认 `acceptEdits`；其它磁盘值归一为 `acceptEdits`
- 斜杠菜单只列：compact、clear、rewind、mcp、status、tasks、workflows
- 斜杠发送不进模型；`/clear` 流式中忽略；compact/rewind 流式中先 abort
- 不接：/btw、插件市场、Cron、Plan、skill 进斜杠、SDK 消息队列
- 包管理器：pnpm；测试：Vitest
- 新 webview 测试优先 `packages/webview/tests/muse/**` 或 `tests/components/**`；修复已有 `tests/webview` 契约使其变绿

## File Structure

```text
packages/server/src/sessionStore.ts          # permissionMode 联合类型
packages/server/src/wsEvents.ts              # 新 WS 事件
packages/server/src/sessionRunner.ts         # Agent 包装 + 回调 + 控制方法
packages/server/src/routes/sessions.ts       # 新 HTTP
packages/server/src/app.ts
packages/server/tests/sessionRunner.control.test.ts
packages/server/tests/sessions.control.routes.test.ts
packages/webview/src/muse/apiClient.ts
packages/webview/src/muse/wsClient.ts
packages/webview/src/muse/hostBridge.ts
packages/webview/tests/muse/hostBridge.control.test.ts
packages/webview/src/components/MessageInput.tsx
packages/webview/src/components/ChatApp.tsx
packages/webview/src/components/StatusDialog.tsx
packages/webview/src/components/ConfirmationDialog.tsx
packages/webview/tests/components/permissionModeTwoOptions.test.tsx
```

---

### Task 1: 权限类型 + session 持久化 + Agent.create 传入

**Files:**
- Modify: `packages/server/src/sessionStore.ts`
- Modify: `packages/server/src/sessionRunner.ts`（create 选项 `permissionMode`）
- Modify: `packages/server/src/routes/sessions.ts`（PATCH 接受 permissionMode）
- Test: `packages/server/tests/sessionRunner.lifecycle.test.ts` 或新建 `sessionRunner.control.test.ts`

**Interfaces:**
- Produces: `export type MusePermissionMode = "acceptEdits" | "bypassPermissions"`
- `Session.permissionMode: MusePermissionMode`
- `normalizePermissionMode(value: unknown): MusePermissionMode` — 非这两值 → `acceptEdits`
- `Agent.create({ permissionMode: session.permissionMode })`

- [ ] **Step 1: 写失败测试**

`packages/server/tests/sessionRunner.control.test.ts`：createAgent 捕获 options.permissionMode；store.create 默认 acceptEdits；PATCH 成 bypass 后下次 ensure（发消息）传入 bypass。可先只测 create 默认值。

```ts
it("passes session permissionMode into Agent.create", async () => {
  const seen: string[] = [];
  const { runner, store, home } = setupRunner({
    createAgent: async (opts) => {
      seen.push(String(opts.permissionMode));
      return stubAgent();
    },
  });
  const session = store.create({ workdir: home, model: "gpt-4.1" });
  store.update(session.id, { permissionMode: "bypassPermissions" });
  await runner.sendMessage(session.id, "hi");
  await waitUntil(() => seen.length > 0);
  expect(seen[0]).toBe("bypassPermissions");
});
```

`setupRunner` / `stubAgent` 从现有 `sessionRunner.test.ts` 抽同样的 temp home + stub provider 模式，写在本测试文件内。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.control.test.ts`

Expected: FAIL — create 仍写死 `permissionMode: "acceptEdits"`

- [ ] **Step 3: 实现**

`sessionStore.ts`：`permissionMode` 改为联合类型；load 时 `normalizePermissionMode`。

`handlePatchSession`：若 body.permissionMode 为两合法值之一则写入。

`createAgentWithRestore`：`permissionMode: store.get(sessionId)?.permissionMode ?? "acceptEdits"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.control.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求提交时）

---

### Task 2: compact / clear / rewind

**Files:**
- Modify: `packages/server/src/sessionRunner.ts`
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/sessionRunner.control.test.ts`
- Test: `packages/server/tests/sessions.control.routes.test.ts`

**Interfaces:**
- `SessionRunner.compact(sessionId: string): Promise<{ ok: true }>`
- `SessionRunner.clear(sessionId: string): Promise<{ ok: true }>`
- `SessionRunner.listRewindCheckpoints(sessionId: string): Promise<{ id: string; content: string }[]>`
- `SessionRunner.rewind(sessionId: string, messageId: string): Promise<{ ok: true; inputContent: string }>`
- `SessionAgent.compact? / clearMessages? / truncateHistory? / getMessages?`

检查点：`role === "user"` 且非 meta/bang/task_notification/hook text。content 取首个 text block。

rewind：找到 messageId 的下标 `i`，`truncateHistory(i)`，返回该用户消息文本。找不到 → 404。

HTTP：
- `POST /sessions/:id/compact`
- `POST /sessions/:id/clear`
- `GET /sessions/:id/rewind-checkpoints`
- `POST /sessions/:id/rewind` body `{ messageId }`

clear/compact 若 status===running：compact/rewind 先 `abortMessage`；clear 若 running 返回 409 `{ error: "session is running" }`。

- [ ] **Step 1: 写失败测试**

stub Agent 记录 compact/clear/truncate 调用；GET checkpoints；POST rewind 校验 truncate 下标与返回 `inputContent`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.control.test.ts tests/sessions.control.routes.test.ts`

Expected: FAIL 404 on new routes

- [ ] **Step 3: 实现 runner + routes + app.ts 路由表**

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

---

### Task 3: 回调推送 tasks / background / workflow / mcp / tokens / permission-mode

**Files:**
- Modify: `packages/server/src/wsEvents.ts`
- Modify: `packages/server/src/sessionRunner.ts`（create 时 callbacks）
- Modify: `packages/webview/src/muse/wsClient.ts`（类型）
- Test: `packages/server/tests/sessions.ws.test.ts` 追加用例

**Interfaces:**

```ts
| { type: "tasks:update"; tasks: unknown[] }
| { type: "background-tasks:update"; tasks: unknown[] }
| { type: "workflow-runs:update"; runs: unknown[] }
| { type: "mcp:update"; servers: unknown[] }
| { type: "permission-mode"; mode: "acceptEdits" | "bypassPermissions" }
| { type: "tokens:update"; latestTotalTokens: number }
```

`onTasksChange` / `onBackgroundTasksChange` / `onMcpServersChange` / `onPermissionModeChange` / `onLatestTotalTokensChange` → broadcast。

`onNotificationMessageAdded`：再读一遍 background tasks + workflow runs 并 broadcast（Agent 上 `getWorkflowRuns` 若存在）。

`snapshotEvents`：running 或有非空 tasks/background/workflow 时附带这些事件。

- [ ] **Step 1: 写失败测试**（sendMessage 里触发 `opts.callbacks?.onTasksChange?.([...])`，WS 收到 `tasks:update`）

- [ ] **Step 2: 跑失败**

- [ ] **Step 3: 接线 callbacks**

- [ ] **Step 4: 跑通过**

---

### Task 4: MCP / status / background stop / workflow stop HTTP

**Files:**
- Modify: `packages/server/src/sessionRunner.ts`
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/sessions.control.routes.test.ts`

**Interfaces:**
- `GET /sessions/:id/status` → `{ sessionId, workdir, permissionMode, latestTotalTokens, waveSessionId }`（version 可由 server package.json，没有则省略）
- `GET /sessions/:id/mcp`
- `POST /sessions/:id/mcp/:name/connect|disconnect`
- `GET /sessions/:id/background-tasks/:taskId/output`
- `POST /sessions/:id/background-tasks/:taskId/stop`
- `GET /sessions/:id/workflows`
- `POST /sessions/:id/workflows/:runId/stop`
- `GET /sessions/:id/slash-commands` → 固定 7 条 `{ id, name, description }[]`（无需 Agent）
- `POST /sessions/:id/permission-mode` body `{ mode }` 或走 PATCH（Task 1 已 PATCH）；本任务补 runner.setPermissionMode 调 SDK 并 WS `permission-mode`

无 Agent 时 GET mcp/status tokens=0、servers=[]；connect/stop 先 ensureAgent。

- [ ] **Step 1–4:** 测试 200 + stub 调用；实现；通过

---

### Task 5: apiClient + hostBridge

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`
- Modify: `packages/webview/src/muse/hostBridge.ts`
- Test: `packages/webview/tests/muse/hostBridge.control.test.ts`
- Modify: `packages/webview/tests/muse/hostBridge.test.ts` stubApi 补新方法（避免类型破）

**Interfaces:** `MuseApiClient` 增加与 Task 2/4 对应的方法。

hostBridge `postMessage` switch 增加：

| command | 动作 |
|---|---|
| requestSlashCommands | GET slash-commands → `slashCommandsResponse` |
| clearChat | POST clear → `updateMessages` 再 GET messages |
| compactChat | POST compact |
| listRewindCheckpoints | GET rewind-checkpoints → `rewindCheckpoints` |
| rewindToMessage | POST rewind → updateMessages + 把 `inputContent` 推 `setInitialState` 或专用 command（沿用 rewind 测试：`setInitialState` 带 inputContent） |
| setPermissionMode | PATCH session permissionMode |
| getMcpServers | GET mcp → `mcpServersResponse` |
| connectMcpServer / disconnectMcpServer | POST |
| getStatus | GET status → `statusResponse` |
| getBackgroundTaskOutput | GET output → `backgroundTaskOutput` |
| stopBackgroundTask | POST stop |
| stopWorkflowRun | POST stop |
| showDialog 不走 HTTP | 直接 `postToWebview({ command: "showDialog", dialogType })`（ChatApp 已处理） |

WS：`tasks:update` → `updateTasks` 等，见 spec §8。

rewind 成功后：GET messages 推 `updateMessages`；`postToWebview({ command: "setInitialState", ... })` 太重。改：`postToWebview({ command: "rewindComplete", messages, inputContent })`。若现有 rewind 测试依赖 setInitialState，host 用 `setInitialState` 最小字段（messages + inputContent + 现有 state 默认）。**优先兼容 `rewind.test.tsx`：host 推 `setInitialState` 含 messages 与 inputContent。**

- [ ] **Step 1:** hostBridge 测试：`postMessage({command:"clearChat"})` 调用 `api.clear`；WS `tasks:update` 转 `updateTasks`
- [ ] **Step 2–4:** 实现并跑 `pnpm -F @muse-work/webview test tests/muse/hostBridge.control.test.ts`

---

### Task 6: 斜杠弹层 + 发送拦截

**Files:**
- Modify: `packages/webview/src/components/MessageInput.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`
- 已有测试：`tests/webview/slash-commands.test.tsx`、`clearChat.test.tsx`、`rewindPopup.test.tsx`

**行为：**
- 输入以 `/` 开头且无空格（行首 slash）时 `requestSlashCommands`（debounce 150ms）
- 收到 `slashCommandsResponse` 显示 `SlashCommandsPopup`
- Enter 选中插入 `/name `
- `handleSendMessage`：trim 后若匹配 `^/(clear|compact|rewind|mcp|status|tasks|workflows)(\\s|$)` 则发对应 command，不发 `sendMessage`
  - clear → clearChat（若 `state.isStreaming` return）
  - compact → compactChat
  - rewind → listRewindCheckpoints 并 setRewindPopupOpen
  - mcp/status/tasks/workflows → `showDialog` 或直接 `SHOW_DIALOG` dispatch + 对 status/mcp 仍 post 命令以便 host 拉数据

ChatApp 已有 rewind popup 状态；补发送拦截即可。

- [ ] **Step 1:** 跑已有 `slash-commands.test.tsx` / `clearChat` / `rewindPopup` 确认当前失败
- [ ] **Step 2:** 实现到测试绿
- [ ] **Step 3:** `pnpm -F @muse-work/webview test tests/webview/slash-commands.test.ts tests/webview/clearChat.test.tsx tests/webview/rewindPopup.test.tsx`

---

### Task 7: 权限下拉仅两项

**Files:**
- Modify: `packages/webview/src/components/MessageInput.tsx`（或抽出 `PermissionModeSelect.tsx` 若文件已过大——优先最小改动挂回 MessageInput）
- Modify: `packages/webview/src/components/ConfirmationDialog.tsx`（隐藏 plan/default 切换）
- Test: `packages/webview/tests/components/permissionModeTwoOptions.test.tsx`
- 更新：`tests/webview/permissionModeCycle.test.tsx` 与 `permissionModeDropdown.test.tsx` 改为只循环/只含两项（否则会红）

Shift+Tab：acceptEdits ↔ bypassPermissions。点击下拉发 `setPermissionMode`。host 回 `updatePermissionMode` 后 class `mode-acceptEdits` / `mode-bypassPermissions`。

- [ ] **Step 1:** 新测试：下拉只有 2 个 `.permission-mode-item`；无 `data-value="plan"`
- [ ] **Step 2–4:** 实现；改旧测试；通过

---

### Task 8: StatusDialog token；确认 TaskList 已绑 updateTasks

**Files:**
- Modify: `packages/webview/src/components/StatusDialog.tsx`
- Test: `packages/webview/tests/components/statusDialog.tokens.test.tsx`
- 核对 ChatApp 已处理 `updateTasks`（已有）无需新 UI

`statusResponse` 增加 `latestTotalTokens` 显示为「上下文用量」一行。

- [ ] **Step 1–4:** 测试 sendCommand statusResponse 后能看到数字；实现

---

## 验证

全部完成后：

```bash
pnpm -F @muse-work/server test
pnpm -F @muse-work/webview test tests/muse tests/components tests/webview/slash-commands.test.tsx tests/webview/clearChat.test.tsx tests/webview/rewindPopup.test.tsx tests/webview/rewind.test.tsx tests/webview/permissionModeCycle.test.tsx tests/webview/permissionModeDropdown.test.tsx
```
