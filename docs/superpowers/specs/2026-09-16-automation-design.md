# 自动化（Automation）Spec

日期：2026-09-16
状态：已批准
来源：对话确认（独立 Agent 运行、cron + 本机 Issue hook、独立自动化页面而非侧栏分组、规则预授权无人值守、skill 创建、停用/重新启用）

## Vocabulary

**自动化（Automation）**：用户保存的一条无人值守规则。含指令、工作目录、权限档、触发器。触发后跑独立 Agent，**不**走 Issue 状态机。
_Avoid_: 把运行当成 Issue、Todo、Task 实体

**运行（AutomationRun）**：一次触发产生的执行记录，绑定一条隐藏 session（`origin: automation`）。
_Avoid_: 把运行混进日常会话树

**触发器（Trigger）**：v1 仅 `cron` 与本机 `issue` 生命周期。一条规则可挂多个。
_Avoid_: GitHub 轮询、HTTP webhook、POPO 当触发器（均非 v1）

**停用 / 启用**：`enabled` 开关。停用不删规则、不删历史运行；重新启用立即接受后续 cron / Issue 事件，不补跑停用期间错过的拍。
_Avoid_: 用删除代替停用、停用后从列表藏掉规则

## Problem Statement

Muse Work 已有会话、Issue、POPO 入站消息，但没有「到点或事件发生后自动跑一轮 Agent」。Cursor / Codex / Workbuddy 的自动化是：存一份指令和工作目录，由调度或钩子启动 Agent，运行记录与日常聊天分开。

用户需要在本机（应用在跑时）用 cron 和 Issue 生命周期启动独立 Agent；也要能在对话里用 skill 创建和管理规则。

## Solution

本地 server 增加一等公民 Automation：规则和运行索引写在 `~/.muse-work/db`。`TriggerHub` 接收 cron 与 Issue 事件，经 `RunExecutor` 复用 `sessionRunner` 开隐藏 session。权限用规则上的预授权档（`bypassPermissions` + 工具黑名单），不弹确认。UI 对齐 Cursor / Codex：**独立自动化页面**（侧栏只留入口，规则不进会话树分组）。内置 plugin `automation` 提供 skill，与 UI 打同一套 REST。

## User Stories

1. 作为用户，我想从侧栏顶部进入独立的「自动化」页面，在整页里新建规则（名称、prompt、workdir、触发器、权限档），以便不经过对话也能登记
2. 作为用户，我想在普通会话或 POPO 里说「每天九点检查 changelog」就用 skill 创建规则，workdir 默认当前会话目录
3. 作为用户，我想用 cron 在应用运行时到点自动开跑，以便例行巡检
4. 作为用户，我想在本机 Issue 创建 / 进入待审核 / 完成 / 取消时自动跑一轮（可按标签、优先级过滤），以便收口或通知类任务
5. 作为用户，我想预置权限，触发后不等人点确认，以便无人值守
6. 作为用户，我想在自动化页面看到规则列表、最近运行、失败原因，点进详情只读打开 transcript，并能停止正在跑的运行
7. 作为用户，我想「立即运行」一条规则（UI 或 skill），以便调试 prompt
8. 作为用户，我不想让自动化会话出现在置顶/工作空间/待办事项里，以免日常聊天被刷爆
9. 作为用户，我想停用一条规则（UI 开关或 skill），停用后 cron 和 Issue 都不再自动触发，规则和历史运行仍留在列表
10. 作为用户，我想重新启用已停用的规则，从下一个 cron 拍或下一次 Issue 事件起恢复，不必重建
11. 作为用户，我想明确说删除时才删规则；停用不是删除
12. 作为用户，我想同一规则上一次还在跑时跳过新触发，以免堆叠

## Implementation Decisions

### 实体与存储

**Automation**

| 字段 | 说明 |
|---|---|
| `id` | 稳定 id |
| `name` | 必填 |
| `description` | 可空 |
| `enabled` | 默认 `true`；`false` 为停用，见「停用与重新启用」 |
| `prompt` | 必填，触发后作为用户指令 |
| `workdir` | 必填；绝对路径；不存在则创建失败 / 触发记 `failed` |
| `agentName` / `model` | 可空，空则用 session 场景默认 |
| `permission` | v1 仅 `workspace`（默认） |
| `triggers` | 至少一项，见下 |
| `createdAt` / `updatedAt` | 毫秒 |

未启用草稿允许空字段，启用前必须齐。

`triggers[]` 每项恰好一种。**UI 不出现 cron 字符串**；人用「周期 / 按间隔 / 单次」或 Issue 事件，server 再编译存储。

- `{ type: "cron", expr }`：由「周期」「按间隔」编译出的 5 字段 cron，按**主机本地时区**解释。非法表达式 400。skill 仍可直接传 `--cron`。
- `{ type: "once", at }`：`at` 为本地日期时间（毫秒时间戳）。到点 enqueue 一次，之后该触发器保留但不再开火（或标 `firedAt`）。应用没开则错过不补。
- `{ type: "issue", events, tags?, priority? }`：`events` 为非空数组，元素 ∈ `created` \| `review` \| `completed` \| `cancelled`。`tags` 为子集匹配（规则 tags 均为 Issue tags 的子集才命中；省略则不过滤）。`priority` 省略则不过滤。

周期 UI → cron 映射（本地时区）：每天 `M H * * *`；工作日 `M H * * 1-5`；每周某日 `M H * * D`。按间隔：每 N 小时 `0 */N * * *`（N 整除 24）；每 N 分钟在能表达时用 `*/N * * * *`，否则 400 并让 UI 限制常用档（1/5/10/15/30 分，1/2/3/4/6/8/12 小时）。

**AutomationRun**

| 字段 | 说明 |
|---|---|
| `id` | 稳定 id |
| `automationId` | 所属规则 |
| `sessionId` | 隐藏 session；`skipped` 可空 |
| `status` | `queued` 不用。`running` \| `succeeded` \| `failed` \| `stopped` \| `skipped` |
| `trigger` | `{ type: "cron" \| "once" \| "issue" \| "manual", firedAt, issue?: { id, title, status, priority, tags } }` |
| `skipReason` | `skipped` 时必填：`rule_running` \| `global_concurrency` |
| `error` | `failed` 时的短消息 |
| `startedAt` / `endedAt` | `skipped` 可只有 `startedAt`（写入时刻） |

存储（对齐 Issue：内存 Map + JSON 原子写，不用 SQLite）：

- `~/.muse-work/db/automations.json` — `{ version: 1, automations: Automation[] }`
- `~/.muse-work/db/automation-runs.json` — `{ version: 1, runs: AutomationRun[] }`

每条规则磁盘上最多保留 **100** 条运行（含 skipped）；超出删最旧。侧栏默认展示每条规则最近 **20** 条。

Session 增加 `origin: "user" | "automation"`，缺省 `"user"`。`origin === "automation"` 的会话：

- 不进入 `listGrouped` 的 pin/recent
- 不进入 Issue 侧栏分组
- 标题用规则名，如 `自动化 · {name}`
- 删除规则**不**级联删 session 文件；运行列表仍能按 `sessionId` 打开，直到用户清运行或手动删 session（v1 不提供「清运行」按钮，只靠 100 条裁剪；transcript 文件可残留，YAGNI 清理）

### 权限档 `workspace`

- `permissionMode: bypassPermissions`（不弹工具确认）
- `disallowedTools` 至少包含 `Workflow`（后台任务完成后自动化收不到通知）
- 不另开沙箱。Agent 可读写 `workdir`、用终端；风险由「谁创建了这条规则」承担
- v1 不提供 `full` 或其他档；字段保留字符串以便以后扩展

自动化运行的 session **不挂** `automation` 插件（防止运行中再创建规则）。**不挂** `issue` 插件（运行不关单、不 dispatch）。Superpowers / mattpocock 仍走全局设置。

### 停用与重新启用

停用是一等能力，不是删除的弱化版。规则始终出现在 `GET /automations` 和侧栏（停用态有明确徽标/灰显）。

| 动作 | 行为 |
|---|---|
| 停用 | `enabled=false` 立刻持久化并 `automation:changed`。之后 cron tick 与 Issue hook **不得** `enqueue`（连 `skipped` 都不写）。正在 `running` 的这一轮**不**自动 abort，可单独 stop。 |
| 重新启用 | `enabled=true` 立刻生效。下一个匹配的 cron 分钟、下一次匹配的 Issue 事件会 enqueue。停用期间错过的 cron **不补跑**。 |
| 幂等 | 已停用再 disable、已启用再 enable 均 200，返回当前规则。 |
| 与删除 | disable 保留 id、prompt、triggers、runs。delete 才去掉规则。 |

专用接口（skill / UI 开关走这两条，避免和 PATCH 正文混用）：

- `POST /automations/:id/disable`
- `POST /automations/:id/enable`

`PATCH` 仍可改 `enabled`，语义与上表相同。

**立即运行**：停用期间 **不允许** `POST /automations/:id/run`（403，`error: disabled`）。要试跑先启用。避免「看起来关了其实还能被按钮打醒」。

### TriggerHub 与并发

`enqueue(automationId, triggerPayload)`：

1. 规则不存在或 `enabled === false` → 忽略（不写 run）
2. 该规则已有 `status === "running"` → 写 `skipped` / `rule_running`，广播
3. 全局 `running` 自动化数 ≥ **2** → 写 `skipped` / `global_concurrency`
4. 否则写 `running`，调用 `RunExecutor`

**CronScheduler**：server 启动后按分钟对齐 tick（允许 ±数秒）。每条 enabled 的 cron 规则：表达式匹配当前本地分钟则 enqueue。应用没开或 server 没起时**不补跑** missed beat。

**IssueHook**：`issueStore` 增加 `subscribe`。在成功 `create`、进入 `review`、`complete`、`cancel` 之后 emit `{ event, issue }`。`created` 对应 create；`review` 对应首次进入 `review`（已在 review 时再 dispatch **不**重复 emit）。Hub 对每条匹配规则各 enqueue 一次。一次 Issue 事件可触发多条规则。Issue 状态**不**因自动化改变。

**手动**：`POST /automations/:id/run`，`type: "manual"`。仅 `enabled === true`；停用则 403。

### RunExecutor

1. `sessionStore.create`：`origin: "automation"`，`workdir` 来自规则，`permissionMode: bypassPermissions`，agent/model 来自规则或默认，`disallowedTools` 按权限档
2. 用户消息 = 规则 `prompt`；若 trigger 为 issue，在消息前附加固定中文上下文块（Issue id、标题、状态、优先级、标签、描述截断）
3. cron / manual 附带触发时间
4. `runner.sendMessage`；`onTurnSettled`：若 session 属于某 `running` 的 AutomationRun，则标 `succeeded` / `failed` / `stopped`（对齐现有 interrupt）
5. server 启动时：磁盘上仍为 `running` 的 run 改为 `failed`，error 为「进程退出」

workdir 在 enqueue 时校验：路径不存在或不可读 → run `failed`，不创建 session。

### REST / WS

| 方法 | 行为 |
|---|---|
| `GET /automations` | 全部规则 |
| `GET /automations/:id` | 单条 |
| `POST /automations` | 创建；校验 name/prompt/workdir/triggers |
| `PATCH /automations/:id` | 元数据、prompt、triggers、enabled、agent、model |
| `POST /automations/:id/disable` | 停用；幂等 |
| `POST /automations/:id/enable` | 重新启用；幂等 |
| `DELETE /automations/:id` | 删除规则；不删 session 文件 |
| `POST /automations/:id/run` | 立即运行；停用时 403 |
| `GET /automations/:id/runs` | 该规则运行，新到旧 |
| `POST /automations/runs/:runId/stop` | 对关联 session `abort`，run → `stopped` |

创建/更新非法 cron、空 events、未知 permission → 400。

WS：`automation:changed`（规则或运行变化，刷新自动化页面即可，不做增量 payload）。打开 transcript 走现有 session 消息接口；webview 须允许加载 `origin: automation` 的 session，即使它不在会话树。

`GET /sessions` 列表不返回 automation origin；`GET /sessions/:id` 对 automation session 仍 200，以便打开 transcript。

### 内置 plugin `automation`

路径：`packages/server/plugins/automation/`（对齐 `issue`）。

- 始终挂载：普通会话、POPO、Issue 规划/单 agent 会话
- 不挂载：Issue 执行会话、自动化运行 session

Skill `automation-management`：通过 `scripts/automation.mjs` 调本地 REST（Base URL 与 issue skill 相同：`MUSE_SERVER_URL` / `server-url` 文件 / 默认端口）。

| 命令 | 行为 |
|---|---|
| `create` | 必填 `--name` `--prompt` `--workdir`；`--cron` 可重复；`--issue-events created,review`；可选 `--tags` `--priority` `--description` `--model` `--agent`。workdir：调用方传入；skill 文案写明「当前会话有 workdir 则默认用它」——由模型从 system/上下文取路径传入，server 不猜 |
| `get` / `list` | 读 |
| `update` | 改字段；改 triggers 为整表替换或明确 flag，禁止静默清空 |
| `enable` / `disable` | 重新启用 / 停用；不是删除。用户说「先别跑 / 暂停」用 disable；说「再打开 / 恢复」用 enable |
| `run` | 立即运行；停用时把 403 原文回给对话，提示先 enable |
| `runs` | 最近运行 |
| `delete` | **仅当用户明确说删除**；skill 正文写明禁止猜测删除 |

Skill 禁止：替用户编造 cron、在用户没说触发器时创建规则、用自动化去 `dispatch` Issue。

### Webview

对齐 Cursor / Codex：**自动化是独立主页面，不是侧栏会话树里的分组。**

- 侧栏顶部菜单（与「新对话」同级）增加常驻项「自动化」。点中后主栏切到自动化页面，菜单项高亮。会话树 / 待办事项**不**列出规则或运行。
- **列表页**：大标题「自动化」+「新建自动化」。通栏卡片：开关、名称、触发器摘要、最近运行。停用灰显但仍列出。
- **编辑器页（Cursor / Codex 式，不是弹窗表单）**：新建与点卡片都进同一页。
  - 标题可直接改（空显示「未命名」）
  - 元信息行：启用开关（已停用/已启用）｜选择工作目录｜权限档
  - Tab：**设置** / **运行记录**
  - 设置 · 触发器：`+ 添加触发器` → 定时调度 或 Issue 生命周期。定时块为「执行频率」：分段 **周期 / 按间隔 / 单次**，周期用「每天/工作日/每周×」+ 时刻，**不提供 cron 文本框**
  - 设置 · Agent 指令：大输入框（可 @ 文件、/ 命令）；框内底部选模型
  - 立即运行（停用禁用）、删除（确认）
- **Transcript**：运行记录里点一次，右侧只读抽屉（可 stop）
- skill 创建的规则出现在此页面，同样不进侧栏分组。skill 可用 `--cron`；打开编辑器时把 cron 反解成周期/间隔控件，解不了则该条显示只读 cron 摘要（不作为新建主路径）。

v1 不做系统通知、不做错过的 cron 补跑、不做运行排队。

### 测试

只测外部行为。

- Seam 1：Automation REST（CRUD、非法 cron、缺 trigger、disable/enable 幂等、停用后 cron/issue 不 enqueue、停用后 run 403、重新启用后可 enqueue、delete）
- Seam 1b：plugin 脚本 disable/enable 打测服 HTTP
- Seam 2：enqueue 并发（同规则 running → skipped；全局 2 槽满 → skipped）
- Seam 3：cron tick 在固定时钟下匹配/不匹配；missed beat 不补
- Seam 4：Issue create/review/complete/cancel 命中过滤；review 期间再 dispatch 不重复 emit
- Seam 5：RunExecutor 创建 `origin: automation` session，列表 API 不含该 session，按 id 能取消息；turn 结束更新 run 状态；启动时 running → failed
- Seam 6：plugin 脚本 create/list/run 打测服 HTTP
- Seam 7：侧栏会话树不展示 automation session 或规则分组；「自动化」菜单打开独立页面并列出规则

## 边界场景

- 规则停用：cron / issue 不 enqueue；手动 run 403；列表仍可见；进行中的 run 继续直到结束或 stop
- 重新启用：不补跑停用期间的 cron；下一拍/下一事件才跑
- 一条规则多个 cron：同一分钟内每个匹配的 expr 都 enqueue；若第一条已 running，后续 skipped
- Issue 事件同时命中多条规则：独立 enqueue，共享全局槽
- 用户在 transcript 里误点发送：v1 UI 只读，不提供 composer
- 删除正在 running 的规则：先 abort session，run `stopped`，再删规则；孤立 run 仍留在 runs 文件直到裁剪（`automationId` 指向已删 id，列表按规则查则看不到；`GET /automations/:id/runs` 404）
- 时区：DST 按主机本地 `Date`；不存 IANA timezone 字段

## Out of Scope

- 外部 GitHub/GitLab 轮询、HTTP webhook、Slack、POPO 作为触发器
- 把运行混进日常会话或走 Issue dispatch
- 运行排队、错过的 cron 补跑、系统通知
- 仓库内 YAML、launchd/crontab
- 多档权限 UI、自动化 session 内再创建自动化
- 云端调度（应用未打开时不跑）

## 非目标检查

- 不引入 SQLite 或新桌面进程
- 不修改 Issue 状态机语义，只加 subscribe
- 不把 Workflow 工具留给无人值守运行
