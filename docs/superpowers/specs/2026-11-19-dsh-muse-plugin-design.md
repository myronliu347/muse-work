# Muse as a DeepSeek Harness bundle

目标：把 Muse 的「助手 + 自动化 + 事项」做成一个可安装的 DSH bundle，agent 运行时完全使用 DSH（`ctx.agents` / `ctx.sessionController` / `ctx.schedule`），Muse 不再维护 `@muse-work/agent` 与 Electron 外壳。

这份文档定的是**插件化路线**（Muse 进 DSH），不是「DSH 嵌进 Muse」。产品形态因此变成：DSH 里的一个工作台 bundle，而不是一个独立桌面应用。

信息架构按截图定死：**小盏是独立页面，不是一条会话。** 左侧图标栏放小盏 / 会话 / 事项 / 自动化；会话页原样留给 DSH 的会话；小盏页有自己的消息流和输入框，跑在页面后面的是 DSH 的一条隐藏助手会话。

## 1. 形态

一个 npm 包 = 一个 bundle：

```
@muse-work/dsh-muse
├── cordis.patch.yml       # 插入 host 服务、两个预设、client 入口
├── host.js                # ctx.muse：事项存储、会话绑定、HTTP 资源路由
├── tools.js               # preset 作用域内的助手工具
├── client.js              # 懒加载 CJS：侧栏入口 + 事项页
├── locale/{en,zh}.json    # 插件标题/描述
├── icon.svg
└── docs/DETAIL.md
```

安装方式：`plugin_manager` `install_bundle`，或桌面端 **Plugins → Add plugin** 选本地目录。

## 2. 架构

```
┌────────────────────────── DSH Host ──────────────────────────┐
│ sessionController / agents   schedule   approval   storage?  │
│        ▲                         ▲                           │
│        │                         │                           │
│   ctx.muse (host plugin) ────────┘                           │
│     ├─ issues.json   事项状态机                               │
│     ├─ issue ↔ sessionId 绑定（sidecar）                      │
│     └─ HTTP: /muse/issues…                                    │
│        ▲                                                     │
│        │ inject                                              │
│   @muse-work/dsh-muse/tools（muse-lead 预设内）                │
│        CreateIssue / ListIssues / GetIssue / MessageIssue …   │
└──────────────────────────────────────────────────────────────┘
        ▲
        │ slots（sidebar.panellist + main）
┌───────┴────────── DSH Web Client ────────────────────────────┐
│ Muse 事项页 / 助手页 / 自动化页                                │
│ 复用宿主：终端、文件、变更、jobs、审批、会话                    │
└──────────────────────────────────────────────────────────────┘
```

关键分工：

- **Host 插件**提供跨会话共享的服务与数据，注册在 profile 根作用域（`ctx.provide('muse', api)`）。
- **工具插件**挂在预设里，只对 `muse-lead` 会话可见；它 `inject: ['muse','tools','sessionController']`，消费 Host 服务。
- **预设**：`muse-lead`（总管，带事项工具）与 `muse-exec`（执行，瘦工具集）。两者都用 DSH 自带的 persona / bash / fs / web / compaction 等行。
- **Client 插件**只做页面，不自建外壳；右栏一律复用宿主的终端/文件/变更/jobs。

## 3. 数据模型

先落 `$DSH_HOME/muse/*.json`（原子写）。不立刻用 `ctx.storageDomain`，因为第三方 bundle 能否 import `@deepseek-ai/dsh-storage-domain` 未验证；等验证后再迁移。

```ts
type Issue = {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'running' | 'review' | 'completed' | 'cancelled';
  priority: 'p0' | 'p1' | 'p2';
  workdir?: string;
  sessionId?: string;        // 事项 ↔ 会话绑定
  planningSessionId?: string;
  executionSessionId?: string;
  note?: string;             // 做完向谁汇报
  createdAt: number;
  updatedAt: number;
};
```

DSH 的会话 header 是封闭字段，**没有自定义元数据**，所以绑定关系必须放在插件自己的 sidecar 里，不能写进 session。

## 4. 事项的推进

- `CreateIssue` 只登记，不建会话。
- `MessageIssue` 是唯一的「派活」入口：没有会话就 `sessionController.create({ cwd, agentPreset: 'muse-exec' })`，`rename` 成标题，再 `prompt`；已有会话直接 `prompt`。
- 轮次结束靠 `ctx.on('session/event')` 观察 `turn/end`，把 `running → review` 推进；验收是助手下一轮的职责，不是内核职责。
- `CloseIssue` 取消进行中的轮次（`sessionController.cancel`），写 `closeNote`，从活动列表消失。
- worktree 用 DSH 的 `dsh-experimental-worktree`（实验包），不在本插件里自己跑 `git worktree`。

## 5. 助手：小盏页 + 隐藏会话

小盏是**一个独立页面**，不是 DSH 的会话页。页面看到的是裁剪过的两方对话；页面后面是一条 `muse-lead` 预设的 DSH 会话，**不出现在会话列表里**。

### 页面长什么样

- 左栏图标「小盏」→ `main` key `xiaozhan`。
- 消息流：用户消息、小盏回复、带事项引用的进展消息、时间戳。
- 输入框：发出去就进助手会话的下一轮；回复期间显示「小盏在想」。
- 轨迹/对话两个 tab 先只做「对话」；「轨迹」是助手会话的原始 transcript，属于调试视图，后置。

### 消息从哪来

**不另建消息表，页面是助手会话日志的投影。** 一条消息只有两种来源：

1. 用户在小盏页输入 → 写入助手会话（prompt），日志里是一条 user 消息。
2. 小盏调 `SendMessage` 工具 → 工具调用和参数在日志里，投影成一条助手消息。

这样满足「会话日志是唯一真相」：页面刷新、重连、插件重载都能从日志重建对话，不会出现两套数据不一致。投影在 Host 侧计算，页面通过 `GET /muse/xiaozhan/messages` 轮询（v1）；要流式再换 SSE。

### `SendMessage` 为什么又回来了

DSH 的会话正文对用户可见，但那是「会话页」的规则；小盏页只显示 `SendMessage` 发出来的内容。助手在回合里注入的事项事件、工具步骤、中间推理都不上屏。所以小盏需要 `SendMessage` 作为唯一出口，这和 Muse 原来的语义一致。

### 事件和唤醒

- 用户发言、事项轮次结束、定时结果、审批，统一进 `ctx.muse` 的事件队列。
- 队列单飞：一轮没跑完，后面的事件排队；同一时刻只有一个 driver。
- 注入上下文用 `agent.inject()`（不唤醒），需要它行动时用 `agent.followup()`。
- 助手会话藏起来；设置页给一个「查看小盏原始会话」的调试入口，方便排查。

## 6. 自动化

直接建模成 `ctx.schedule` 任务：

- 定时：`timing: { kind: 'cron' | 'rrule' | ... }`，`target: { kind: 'new_once' | 'new' }`，`create: { cwd, agentPreset: 'muse-exec' }`。
- 运行记录：schedule 只保存**投递回执**，不保存执行结果。插件自己记 `runs.json`，用 `session/event` 把目标会话的 `turn/end` 关联回 run。
- 事项事件触发（created/review/completed/cancelled）不是 schedule 的能力，由插件在事项状态变更时自己 `schedule.run` 或直接派活。
- 「remind」模式：不建会话，直接把 instruction 注入助手会话。

## 7. UI 映射

| 截图里的东西 | DSH 机制 | 说明 |
|---|---|---|
| 左侧图标栏：小盏 / 会话 / 事项 / 自动化 | `sidebar.panellist` 四个入口 + 底部 `sidebar.settings` | 设置复用宿主的 |
| 小盏页 | `main` key `xiaozhan`（自建页面） | 消息流 + 输入框，不碰宿主聊天 |
| 会话页 | 宿主 `conversation`（`main` key `conversation`） | 事项 worker 和普通会话都在这儿 |
| 事项页 | `main` key `issues` | 列表 + 详情 |
| 自动化页 | `main` key `automations` | 规则 + 运行记录 |
| 右侧事项详情 | `rightbar` tab，按会话绑定 | 打开事项会话时自动带出 |
| 设置 | `settings.section` | 小盏原始会话入口、存储路径 |

约束（已核实）：

- 不能替换 App 根、输入框、聊天流；`main` 里只有 `conversation` 这个 key 绑定会话。
- **macOS 桌面端收起侧栏会整列隐藏，不留 56px 轨道**（`ui-layout` 的 darwin 分支）。截图那种常驻窄图标栏要改布局壳，属于 fork，不是插件。
- Client 插件是单文件懒加载 CJS，不能 import DSH 组件库，只能用 `--dsw-*` 主题变量；Muse 现有 36k 行组件需要重写或内联打包。
- 没有 URL 路由，布局状态在内存里，刷新重置；导航只用 `ctx.layout.selectPanel`。

小盏页的聊天 UI 必须自建（宿主 conversation 绑当前会话、显示完整 transcript，不满足裁剪需求）。这部分是纯前端：消息流、输入框、发送/重试、滚动；流式后置。约 2–3 周。

## 8. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0（本切片） | bundle 可装；host 服务 + 4 个事项工具 + 2 个预设 + 事项页 | 在 DSH 新会话里让 agent 建事项并派活；页面能看到事项 |
| M1 | 事项状态机、规划+执行、worktree、关闭、进度事件 | 一条事项从创建到关闭全程不手改文件 |
| M2 | 小盏页（自建消息流 + 输入框）、`SendMessage`、消息投影、隐藏助手会话 | 在小盏页说话能收到回复；刷新后对话还在 |
| M3 | 助手运行时：事件队列、唤醒、验收、汇报 | 事项轮次结束能自动唤醒小盏并汇报 |
| M4 | 自动化：schedule 桥接、runs、事项事件触发、remind | 建一条 cron 规则，到点跑并汇报 |
| M5 | 会话页/右栏/设置/i18n 对齐；debug 轨迹视图 | 日常使用不需要打开 Muse 旧端 |
| M6 | 迁移：旧 `~/.muse-work` 事项/自动化导入；发布 | 老用户升级路径清楚 |

## 9. 风险与未验证项

1. 第三方 bundle 能否注册自定义 Remote 命名空间（本切片先用 HTTP 路由绕过）。
2. 打包版 Desktop 能否给第三方包产出/加载 client bundle（本切片手写 CJS）。
3. Desktop 页面能否 fetch 插件自建的 `/muse/*` 路由（本切片直接验证）。
4. 第三方 bundle 能否 import `@deepseek-ai/dsh-*` 包（结论：大概率不能；本切片零依赖）。
5. DSH 仍是 `0.2.2-rc.3`，内部服务无跨版本稳定性承诺。
6. 会话历史格式不兼容：Muse 的 wave-agent-sdk 日志无法直接读入 DSH，迁移需要转换器或放弃。
7. 审批：DSH 把「授予权限」定为 user-only，助手不能静默代批；`ResolvePermission` 要改成问用户或走实验性 auto-review。

## 10. 不做的事

- 不 fork `dsh-web-app` 换外壳（那是另一个量级的决定）。
- 不搬 Muse 的 Electron 专属能力（node-pty、内嵌浏览器、自动更新），用 DSH 的对应面板。
- 不在插件里自建 agent loop、会话存储或调度器。
- 不把 Muse 的 `SendMessage` 渠道模型带进来；渠道扩展如果需要，另做 host 插件。
