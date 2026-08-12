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
| 并发 | 多 Agent 可同时 running；切会话不销毁 |
| 空闲回收 | 回合结束后 **10min** 无新消息 → `destroy`；下次再 `ensureAgent`（restore） |
| Model | **每会话独立**；选择框在 **sender**（`MessageInput`），不在顶栏 |
| 配置切换 | model 等 Agent 配置变更后，**下次发消息**时 `destroy` → 带 `restoreSessionId` 再 `create` |
| 侧栏状态 | 处理中 **loading**；完成后 **dot**；用户切到该会话后 dot **清除** |

## 3. 数据模型与持久化

**路径**：`~/.muse-work/sessions.json`

```ts
type MuseSessionRecord = {
  id: string; // Muse 侧栏 / API 稳定 ID
  waveSessionId?: string; // SDK transcript id
  title: string; // 默认「新对话」
  workdir: string;
  permissionMode: "acceptEdits"; // MVP 固定，字段预留
  model: string; // 该会话使用的 model；与全局 providers active 解耦
  pinned: boolean;
  /** 非焦点会话回合完成后为 true；用户 select 该会话后清 false（可只存内存，重启可不保留） */
  unreadDone?: boolean;
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
- 索引与 runtime 分离：索引永续；Agent 按需创建，可空闲回收
- **model**：会话级字段；新建时默认取当前 provider 的 active model；之后只改本会话，不影响其它会话与全局默认（除非用户在设置里改全局 active，仅影响**之后新建**的会话）

## 4. HTTP API（muse-server）

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/sessions?grouped=1` | `{ pinned, recent }` 或扁平列表 |
| `POST` | `/sessions` | 新建记录（workdir + model + permissionMode） |
| `GET` | `/sessions/:id` | 元数据 |
| `GET` | `/sessions/:id/messages` | 恢复后的 webview `Message[]` |
| `PATCH` | `/sessions/:id` | title / pinned / model / permissionMode / lastActiveAt |
| `POST` | `/sessions/:id/select` | 切换焦点：更新 `activeSessionId`（不负责 SDK restore；消息用 `GET .../messages`） |
| `DELETE` | `/sessions/:id` | 删索引 + dispose runtime |
| `POST` | `/sessions/:id/messages` | 已有；更新 `lastActiveAt`；空 title 时用首条用户消息 |

`MuseApiClient` 补齐 list / select / patch / delete / getMessages。

## 5. Agent 生命周期与恢复

`sessionRunner`：

1. `Map<museSessionId, Agent>`；**切换会话不 dispose**
2. `ensureAgent(id)`（发消息 / 需要 runtime 读历史时触发；**不是** select 本身）：
   - 已有实例且 **Agent 配置指纹**一致 → 复用
   - 否则见下条「配置切换」
   - `permissionMode: "acceptEdits"`；**model 等配置一律用会话记录**（不用全局 active）
3. `callbacks.onSessionIdChange`（及首次可读的 `agent.sessionId`）→ 写回 `waveSessionId`
3b. **配置切换（model 及其他会影响 `Agent.create` 的选项）**
   - `PATCH`（或等价）只更新 `sessions.json` 会话记录，**不必立刻** destroy
   - **下次发送消息**（`POST .../messages` → `ensureAgent`）时：
     1. 若 Map 中有旧 Agent → `agent.destroy()`，移出 Map
     2. 再用**新配置** `Agent.create`；若有 `waveSessionId` → 传 `restoreSessionId`（带着原 session 继续）
     3. 新 `sessionId` / `onSessionIdChange` 照常回写（一般应仍是同一 wave id；若 SDK 换新 id 则覆盖）
   - 指纹至少包含：`model`、gateway（provider/baseURL/apiKey 身份）、以及后续会进 `AgentOptions` 的会话级字段
   - 仅读历史（`GET .../messages`）若发现配置已变：同样 destroy + 带 `restoreSessionId` 重建，再映射 messages（与发消息同一套 ensure 逻辑）
4. **边界：restore 启动失败**
   - `Agent.create({ restoreSessionId })` 失败（jsonl 缺失/损坏、SDK 拒绝等）→ **不要**卡死该 Muse 会话
   - 回退：不带 `restoreSessionId` 再 `Agent.create` 新建空对话
   - 将新的 `agent.sessionId`（及 `onSessionIdChange`）**回写** `waveSessionId`，覆盖失效旧值
   - UI：历史消息为空（或仅提示无法恢复）；用户可继续发消息
5. 若 restore「成功」但 SDK 随后换新 id → 同样以回调结果覆盖存储
6. `GET .../messages` → `ensureAgent` 后把 `agent.messages` 映射为 UI 消息
7. **空闲回收（10min）**
   - 计时起点：该会话一轮对话结束进入 `idle`（`onLoadingChange(false)` / turn 结束且队列空）
   - 窗口内若有新用户消息（或再次进入 `running`）→ **重置**计时
   - **不**回收：`running`、等待权限、队列非空
   - 到期：`agent.destroy()`，从 Map 移除；**保留** `sessions.json` 与 `waveSessionId`
   - 下次发消息或 `GET .../messages` → 再 `ensureAgent`（走 restore / 失败回退）
   - 常量建议：`AGENT_IDLE_TTL_MS = 10 * 60 * 1000`（可测时可注入缩短）
   - 另：`DELETE`、进程退出仍立即销毁

**多会话并发**

- 不同 museSessionId 的 `sendMessage` / 队列互不阻塞
- 多个可同时 `running`；侧栏 per-session 状态见 §7「侧栏状态指示」
- 空闲回收按会话独立计时，互不影响

## 6. WebSocket

- **推荐**：单连接，事件一律带 `sessionId`
- 当前焦点会话：事件驱动聊天区（delta / tool / …）
- 非焦点会话：驱动侧栏 status（running / idle / error / waiting permission）及 unreadDone
- 兼容：也可每会话一条 WS；MVP 优先单连接 + `sessionId` 字段（需扩展 `wsEvents` / `wsHub`）

## 7. 侧栏 UI 与交互

改 `DesktopSidebar`（去掉按 workdir 大分组）：

- 固定两组：**pin**、**最近**
- 条目：title、workdir 短名、状态指示、悬停图钉、删除
- 「新对话」：始终可用（有 workdir）；streaming 中也可开新会话（其它会话继续跑）

**侧栏状态指示（每条 session）**

| 状态 | UI | 何时出现 / 清除 |
|---|---|---|
| 消息处理中（`running` / 等权限） | **loading**（spinner 或等价） | 该会话 Agent 回合进行中；结束即停 |
| 回合完成且当前**不是**焦点 | **dot**（未读完成标记） | 非 `activeSessionId` 的会话从 running → idle/完成时置位 |
| 用户切到该会话 | 无 loading、无 dot | `POST .../select`（或等价）时清除该会话的 `unreadDone` |
| 焦点会话自己在跑 | 可显示 loading；**不**打 dot | 完成后焦点会话不置 unreadDone |

规则补充：

- loading 与 dot **互斥**：处理中只显示 loading；完成后才可能出现 dot
- 焦点会话完成 → 不打 dot（用户已在看）
- 后台会话完成 → 打 dot，直到用户 **切换过去** 后消失
- 重启 App：`unreadDone` MVP 可不持久化（进程内即可）；若已写入 `sessions.json` 则 select 时清掉

**新建**

1. `POST /sessions`
2. 清 UI 消息、订阅/标记 active、连 WS 语义切到新 id
3. 刷新列表

**切换**

1. `POST /sessions/:id/select` → 更新焦点，并 **清除** 该会话 `unreadDone`（dot 消失）
2. `GET /sessions/:id/messages`（内部按需 ensureAgent：restore 或新建回退）→ `updateMessages` 完整替换
3. 若 workdir 变化 → 同步 `desktopWorkdirState`
4. 不停止其它 Agent

**Pin**：`PATCH { pinned: true/false }` 后刷新分组。

**标题**：首条用户消息入队成功后 `PATCH title`（截断展示）。

**Model（sender）**

- 顶栏 **去掉** 全局 `MuseModelSelect`
- 将模型选择放进 `MessageInput`（sender 工具条，与发送区同区）
- 展示/绑定 **当前焦点会话** 的 `session.model`
- 变更：`PATCH /sessions/:id { model }`；**下次发消息**再 destroy + 带 `waveSessionId` 重建（见 §5.3b）；列表项无需展示 model
- 新建会话：sender 显示新会话默认 model（创建时写入的 active model）
- 切换会话：sender 同步为该会话已存 model
- Provider 仍在设置页切换；model 列表来自当前 active provider

## 8. hostBridge / Desktop 接线

- `newSession` / `desktopSelectSession` / `desktopDeleteSession` / pin → 转 Muse HTTP
- 启动 `desktopReady` 后拉 `GET /sessions?grouped=1` 填侧栏
- 保留少量 `desktopSessionTree` 推送亦可，由 bridge 从 API 组装，避免 Electron main 持会话真相

## 9. 非目标（本 MVP）

- 多 pane 同屏多会话编辑（可后置；数据模型已支持多 runtime）
- 删除时清理 Wave jsonl
- 按数量上限 LRU 回收（仅用 10min 空闲 TTL）
- 用户改 permissionMode（保持 acceptEdits）
- 会话搜索 / 重命名 UI（PATCH 预留 title）

## 10. 测试要点

- 持久化读写 `sessions.json`；重启 server 列表仍在
- restore：有可用 jsonl → 消息恢复
- restore 失败 / 无 jsonl：新建 Agent，新 `waveSessionId` 回写覆盖
- `onSessionIdChange` 更新存储
- 两会话同时 send：均 running；切 UI 不影响后台
- idle 满 10min（测试注入短 TTL）→ Map 无实例，索引与 `waveSessionId` 仍在；再 send → restore 成功且历史在
- running / 等待权限期间不计时或到期不销毁
- pin 悬停切换分组；新建进入最近顶部
- 删除仅影响目标 runtime
- 两会话不同 model；切会话 sender 显示各自 model
- PATCH model（或其它 Agent 配置）后旧实例仍可暂留；**下一次 send** 必须 destroy，再以新配置 + `restoreSessionId` create；历史仍在
- 后台会话 running → 侧栏 loading；完成后出现 dot；select 该会话后 dot 消失；焦点会话完成不打 dot

## 11. 实现顺序建议

1. `sessionsStore` 文件 + 扩展 `Session` 记录类型  
2. HTTP CRUD + select + messages  
3. `sessionRunner`：restore / onSessionIdChange / 不切换 dispose + 10min 空闲 destroy + 会话级 model + WS 带 sessionId + unreadDone  
4. `apiClient` + `hostBridge` 接线  
5. Sidebar UI：pin/最近 + 图钉 + loading/dot；sender 内 model 选择（移除顶栏）  
6. 新建 / 切换 / 标题 / 每会话 model 闭环 + 测试  
