# SDK 控制面接入

**日期**：2026-08-14  
**状态**：已评审（对话确认）  
**来源**：wave-agent-sdk 缺口评估；范围确认：斜杠 1–5、权限仅 acceptEdits/bypass、Workflow、后台 Agent 进度、Task 列表

## 1. 目标

把 `wave-agent-sdk@1.0.7` 已有、Muse 尚未包装的控制面接到现有 webview：用户能压上下文、清空、回滚、切权限、看 MCP/token、看并停止 Workflow 与后台 Agent，以及看到 Task 列表进度。

不新做一套 UI 体系。对话框、TaskList、WorkflowManager、BackgroundTaskManager、RewindPopup、SlashCommandsPopup、权限下拉的测试契约都已存在；本轮补 server / hostBridge，并恢复被拿掉的输入区接线。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 协议 | 沿用 HTTP 控制面 + WS 事件；hostBridge 把 webview `command` 译成 HTTP，把 WS 译成已有 webview command |
| 斜杠菜单 | 输入 `/` 弹出 `SlashCommandsPopup`；本轮只列系统命令（见 §5） |
| 斜杠执行 | 发送时拦截，不作为用户消息发给模型 |
| 权限 | 仅 `acceptEdits` ↔ `bypassPermissions`；默认 `acceptEdits`；写入会话记录 |
| Token | 放进 `/status` 对话框（`latestTotalTokens`） |
| Task 列表 | 已有输入框上方 `TaskList`；接 `onTasksChange` |
| 后台 Agent | `/tasks` → `BackgroundTaskManager`（输出 + 停止）；子 Agent 流式保持现状 |
| Workflow | `/workflows` → `WorkflowManager`（阶段/token/停止） |
| MCP | `/mcp` → `McpDialog`（列表、连接/断开）；不配置编辑器 |

## 3. 范围

**做**

- `SessionAgent` / `sessionRunner` 包装 SDK：`compact`、`clearMessages`、`truncateHistory`、`setPermissionMode`、`getPermissionMode`、MCP connect/disconnect/list、background task output/stop、workflow list/stop、`latestTotalTokens`、slash 列表。
- 回调：`onTasksChange`、`onBackgroundTasksChange`、`onMcpServersChange`、`onPermissionModeChange`、`onLatestTotalTokensChange`、`onNotificationMessageAdded`；压缩回调已有。
- HTTP + WS + `apiClient` + `hostBridge`。
- 恢复输入区：斜杠弹层、发送拦截、权限下拉（两项）、`/status` 显示 token。
- 确认框去掉会切到 `plan` / `default` 的选项。

**不做**

- `/btw`、插件市场、Cron 管理台、Plan 模式、斜杠列出 skill、用 SDK 队列替换 Muse HTTP 队列、Wave SSO/Telemetry。

## 4. 数据流

```text
webview command
  → hostBridge
  → POST/GET /sessions/:id/...
  → sessionRunner.ensureAgent() → Agent.*

Agent callbacks
  → hub.broadcast(sessionId, WsEvent)
  → hostBridge
  → 已有 webview command（updateTasks / updateWorkflowRuns / …）
```

`createAgent` 时传入会话的 `permissionMode`。切换权限：持久化 `sessions.json`，若 runtime 已存在则 `setPermissionMode`，不必重建 Agent。身份指纹**不**包含 permissionMode。

## 5. 斜杠命令

弹出列表（固定，不依赖 SDK `getSlashCommands` 的 skill 项）：

| name | 发送时行为 |
|---|---|
| compact | `compactChat` → `agent.compact()` |
| clear | `clearChat` → `agent.clearMessages()`；流式中忽略 |
| rewind | `listRewindCheckpoints` → 弹窗；确认后 `rewindToMessage` → `truncateHistory`；原文填回输入框 |
| mcp | `showDialog` type=mcp |
| status | `showDialog` type=status（含 token） |
| tasks | `showDialog` type=tasks |
| workflows | `showDialog` type=workflows |

输入 `/` 仍发 `requestSlashCommands`；host 回 `slashCommandsResponse`（上述 7 条）。选中插入 `/name `（现有测试契约）。Skill / plugin / agents / btw / config / model 不进本轮菜单。

流式中 compact/rewind：先 `abortMessage` 再执行。

## 6. 权限

- 类型：`type MusePermissionMode = "acceptEdits" | "bypassPermissions"`
- 磁盘上旧值或其它 SDK 值读入时归一成 `acceptEdits`
- 输入区 `.permission-mode-select` 只渲染这两项；Shift+Tab 在两者间循环
- `bypassPermissions`：`canUseTool` 不再弹确认（SDK 模式负责；Muse 仍实现 callback，但 SDK 在 bypass 下应不调用；若仍调用则自动 allow）
- 确认框：隐藏「切换到 plan / default」类选项；允许本次 allow 时带 `newPermissionMode: bypassPermissions`（已有）

## 7. HTTP

均挂在 `/sessions/:id/`：

| 方法 | 路径 | 作用 |
|---|---|---|
| PATCH | `/sessions/:id` | 已有；扩展 `permissionMode` |
| POST | `.../compact` | compact |
| POST | `.../clear` | clearMessages |
| GET | `.../rewind-checkpoints` | 用户消息检查点 `{ id, content }[]` |
| POST | `.../rewind` | body `{ messageId }` |
| GET | `.../status` | version、sessionId、workdir、latestTotalTokens、permissionMode |
| GET | `.../mcp` | MCP server 列表 |
| POST | `.../mcp/:name/connect` | 连接 |
| POST | `.../mcp/:name/disconnect` | 断开 |
| GET | `.../background-tasks/:taskId/output` | 输出 |
| POST | `.../background-tasks/:taskId/stop` | 停止 |
| GET | `.../workflows` | 运行列表 |
| POST | `.../workflows/:runId/stop` | 停止 |
| GET | `.../slash-commands` | 本轮 7 条 |

无 session 时（草稿）斜杠菜单仍返回这 7 条；执行 compact/clear/rewind/mcp 若无 Agent 则 404。

## 8. WS 事件（新增）

在 `wsEvents.ts` 增加：

- `tasks:update` `{ tasks }`
- `background-tasks:update` `{ tasks }`（`BackgroundTaskSummary[]`）
- `workflow-runs:update` `{ runs }`
- `mcp:update` `{ servers }`
- `permission-mode` `{ mode }`
- `tokens:update` `{ latestTotalTokens }`
- `notification` `{ taskId, taskType, status, summary }` → webview 可走已有 notification 消息块；至少刷新 tasks/background/workflow 快照

`snapshotEvents()` 对 running 会话附带当前 tasks / background / workflow / mcp / tokens / permissionMode，避免 WS 重连丢状态。

hostBridge 映射：

| WS | webview command |
|---|---|
| tasks:update | updateTasks |
| background-tasks:update | updateBackgroundTasks |
| workflow-runs:update | updateWorkflowRuns |
| mcp:update | mcpServersUpdate |
| permission-mode | updatePermissionMode |
| tokens:update | 缓存，供 statusResponse |
| messages:replace | updateMessages（已有） |

## 9. SessionAgent 扩展

`defaultCreateAgent` 把 SDK 方法透出（可选，测试 stub 可缺省）：

```ts
compact?: (instructions?: string) => Promise<void>;
clearMessages?: () => Promise<void>;
truncateHistory?: (index: number) => Promise<void>;
setPermissionMode?: (mode: MusePermissionMode) => void;
getPermissionMode?: () => MusePermissionMode;
getMcpServers?: () => McpServerStatus[];
connectMcpServer?: (name: string) => Promise<boolean>;
disconnectMcpServer?: (name: string) => Promise<boolean>;
getBackgroundTaskOutput?: (id: string, filter?: string) => unknown;
stopBackgroundTask?: (id: string) => boolean;
getWorkflowRuns?: () => Promise<unknown[]>;
stopWorkflowRun?: (runId: string) => void;
latestTotalTokens?: number;
```

`createAgentWithRestore` 把 `permissionMode` 从 session 传入 `Agent.create`。

Rewind：按 `agent.messages` 找 `messageId` 对应的用户消息下标，再 `truncateHistory(index)`。检查点过滤与 webview `isRewindTargetMessage` 一致（非 meta、非 bang、非 task_notification、非 hook text）。

## 10. UI 恢复要点

- `MessageInput`：挂 `SlashCommandsPopup`；`/` 触发 `requestSlashCommands`；消费 `permissionMode` 渲染两项下拉；Shift+Tab 发 `setPermissionMode`。
- `ChatApp.handleSendMessage`：拦截 `/clear` `/compact` `/rewind` `/mcp` `/status` `/tasks` `/workflows`（允许前导空白；命令名后可有参数，本轮忽略参数）。
- `StatusDialog`：`statusResponse` 增加 `latestTotalTokens` 一行。
- 确认框：`permissionMode === "plan"` 相关 UI 可保留代码路径但 Muse 不会进入 plan。

## 11. 测试策略

| 层 | 内容 |
|---|---|
| server | runner：compact/clear/rewind/permission/mcp/tasks/workflow 调到 stub Agent；路由 200/404/400 |
| hostBridge | 各 command → 对应 HTTP；WS → 对应 webview command |
| webview | 优先让已有 `tests/webview` 斜杠/rewind/clear/permission 契约重新变绿；新逻辑放 `tests/muse` 或 `tests/components` |
| StatusDialog | token 行 |

## 12. 成功标准

1. `/` 弹出 7 条系统命令；发送 `/clear` `/compact` `/rewind` 不进模型。
2. rewind 确认后 transcript 截断且文件由 SDK 还原；原文回输入框。
3. 权限下拉只有 acceptEdits / bypass；bypass 后 Bash/Edit 不再弹确认。
4. `/mcp` 能看到连接状态并断开/重连。
5. `/status` 显示 token。
6. 模型 `TaskCreate` 后输入框上方 TaskList 更新。
7. 后台 Agent / Workflow 可在 `/tasks` `/workflows` 看到进度并停止。
