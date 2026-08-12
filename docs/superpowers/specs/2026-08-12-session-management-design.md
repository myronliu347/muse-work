# Muse Work 会话管理设计

**日期**：2026-08-12  
**状态**：已评审（对话确认 §1–§3）  
**范围**：左侧会话列表、本地持久化、新建/切换、Wave `waveSessionId` 恢复、多会话并发

## 1. 目标

- 左侧展示会话列表，分组为 **pin** / **最近**（全局，不限当前 workdir）
- 每条会话持久化：`waveSessionId`、`title`、`permissionMode`、`model`、`workdir`、`pinned` 等
- 新建对话闭环；切换会话时 **完整恢复历史消息** 并可继续聊
- 创建 Agent：`waveSessionId` 存在且可恢复则 `restoreSessionId`，否则新建；`onSessionIdChange` 写回
- **多个 session 可同时 running**，切走不 dispose

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 历史恢复 | A：完整恢复 transcript |
| 列表范围 | B：全局列表（条目显示 workdir 短名） |
| Pin 操作 | A：悬停图钉切换 |
| 架构 | Server 权威（方案 1） |
| 并发 | 多 Agent 常驻 Map；切会话不销毁 |

## 3. 数据模型与持久化

**路径**：`~/.muse-work/sessions.json`

```ts
type MuseSessionRecord = {
  id: string; // Muse 侧栏 / API 稳定 ID
  waveSessionId?: string; // SDK transcript id
  title: string; // 默认「新对话」
  workdir: string;
  permissionMode: "acceptEdits"; // MVP 固定，字段预留
  model: string;
  pinned: boolean;
  createdAt: number;
  lastActiveAt: number;
};

type SessionsFile = {
  version: 1;
  activeSessionId?: string;
  sessions: MuseSessionRecord[];
};
```

**规则**

- **pin**：`pinned === true`，按 `lastActiveAt` 降序
- **最近**：未 pin，按 `lastActiveAt` 降序（可截断，如 50）
- 删除：移出索引 + dispose 该 runtime；MVP **不**删除 `~/.wave/projects/...` jsonl
- 索引与 runtime 分离：索引永续；Agent 按需创建，并发时多实例共存

## 4. HTTP API（muse-server）

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/sessions?grouped=1` | `{ pinned, recent }` 或扁平列表 |
| `POST` | `/sessions` | 新建记录（workdir + model + permissionMode） |
| `GET` | `/sessions/:id` | 元数据 |
| `GET` | `/sessions/:id/messages` | 恢复后的 webview `Message[]` |
| `PATCH` | `/sessions/:id` | title / pinned / model / permissionMode / lastActiveAt |
| `POST` | `/sessions/:id/select` | 激活：ensure Agent + restore + 返回 messages，更新 `activeSessionId` |
| `DELETE` | `/sessions/:id` | 删索引 + dispose runtime |
| `POST` | `/sessions/:id/messages` | 已有；更新 `lastActiveAt`；空 title 时用首条用户消息 |

`MuseApiClient` 补齐 list / select / patch / delete / getMessages。

## 5. Agent 生命周期与恢复

`sessionRunner`：

1. `Map<museSessionId, Agent>`；**切换会话不 dispose**；仅 DELETE 或进程退出时销毁
2. `ensureAgent(id)`：
   - 已有实例且 gateway 身份匹配 → 复用
   - 否则 `Agent.create`：有 `waveSessionId` 则传 `restoreSessionId`；无则新建
   - `permissionMode: "acceptEdits"`；`model` 优先会话记录
3. `callbacks.onSessionIdChange`（及首次可读的 `agent.sessionId`）→ 写回 `waveSessionId`
4. 若 restore 失效导致 SDK 换新 id → 以回调结果覆盖存储
5. `GET .../messages` → `agent.messages` 映射为 UI 消息

**多会话并发**

- 不同 museSessionId 的 `sendMessage` / 队列互不阻塞
- 多个可同时 `running`；侧栏显示 per-session running / waiting

## 6. WebSocket

- **推荐**：单连接，事件一律带 `sessionId`
- 当前焦点会话：事件驱动聊天区（delta / tool / …）
- 非焦点会话：仅更新侧栏 status（running / idle / error / waiting permission）
- 兼容：也可每会话一条 WS；MVP 优先单连接 + `sessionId` 字段（需扩展 `wsEvents` / `wsHub`）

## 7. 侧栏 UI 与交互

改 `DesktopSidebar`（去掉按 workdir 大分组）：

- 固定两组：**pin**、**最近**
- 条目：title、workdir 短名、状态点、悬停图钉、删除
- 「新对话」：始终可用（有 workdir）；streaming 中也可开新会话（其它会话继续跑）

**新建**

1. `POST /sessions`
2. 清 UI 消息、订阅/标记 active、连 WS 语义切到新 id
3. 刷新列表

**切换**

1. `POST /sessions/:id/select` → messages
2. `updateMessages` 完整替换
3. 若 workdir 变化 → 同步 `desktopWorkdirState`
4. 不停止其它 Agent

**Pin**：`PATCH { pinned: true/false }` 后刷新分组。

**标题**：首条用户消息入队成功后 `PATCH title`（截断展示）。

## 8. hostBridge / Desktop 接线

- `newSession` / `desktopSelectSession` / `desktopDeleteSession` / pin → 转 Muse HTTP
- 启动 `desktopReady` 后拉 `GET /sessions?grouped=1` 填侧栏
- 保留少量 `desktopSessionTree` 推送亦可，由 bridge 从 API 组装，避免 Electron main 持会话真相

## 9. 非目标（本 MVP）

- 多 pane 同屏多会话编辑（可后置；数据模型已支持多 runtime）
- 删除时清理 Wave jsonl
- 空闲 Agent 回收上限
- 用户改 permissionMode（保持 acceptEdits）
- 会话搜索 / 重命名 UI（PATCH 预留 title）

## 10. 测试要点

- 持久化读写 `sessions.json`；重启 server 列表仍在
- restore：有 jsonl → 消息恢复；无 jsonl → 新 waveSessionId 写回
- `onSessionIdChange` 更新存储
- 两会话同时 send：均 running；切 UI 不影响后台
- pin 悬停切换分组；新建进入最近顶部
- 删除仅影响目标 runtime

## 11. 实现顺序建议

1. `sessionsStore` 文件 + 扩展 `Session` 记录类型  
2. HTTP CRUD + select + messages  
3. `sessionRunner`：restore / onSessionIdChange / 不切换 dispose + WS 带 sessionId  
4. `apiClient` + `hostBridge` 接线  
5. Sidebar UI：pin/最近 + 图钉  
6. 新建 / 切换 / 标题 闭环 + 测试  
