# Issue 工作流 Spec

日期：2026-09-01
状态：待实现
词汇：见根目录 `CONTEXT.md`

## Problem Statement

用户要把「一件事」从想法推进到可验收的代码变更：需要先规划、再执行、再跟人一起收口。刚移除的 Todo/Task 把每条 task 做成独立会话和调度单元，过重且与「人跟规划 AI 聊到关单」不合。现在需要更轻的一级实体：Issue 上挂结构化清单，固定一对规划/执行会话。

## Solution

新增 Issue：UI 或对话创建；打开规划时选择 workdir 与是否 worktree；规划会话里确认方案并维护清单；规划 AI 用 `dispatch` 把工作送进**同一个**执行会话（配置继承规划会话）。清单全部完成后进入**待审核**，此后状态不再因「还要改」而打回；人继续跟规划 AI 对话（可选 E2E / code review 子代理，仍可 dispatch），直到 UI 或对话把 Issue **完成**或**取消**。

核心价值：**一件事一条线**（1 规划 + 1 执行 + 一份清单），收口只发生在人与规划 AI 的对话或 UI 关闭，没有「审核不通过」状态。

## User Stories

1. 作为用户，我想在侧栏或简单表单里新建 Issue（标题必填，描述/优先级/标签可选），以便不经过对话也能登记
2. 作为用户，我想在普通会话里说「建个 issue：xxx」就创建 Issue，以便顺手记下
3. 作为用户，我想给 Issue 设优先级 p0/p1/p2（默认 p1）和若干标签，以便侧栏排序和筛选观感
4. 作为用户，我想打开规划会话时选择 workdir，以及是否启用 worktree，以便执行环境在动手前就定死
5. 作为用户，我想每个 Issue 只有一个规划会话，首次打开才创建，以便历史不散
6. 作为用户，我想在规划会话里和 AI 多轮确认需求与技术方案，并用工具维护任务清单，以便方案可执行
7. 作为用户，我想确认清单后创建执行会话（workdir/worktree 继承规划会话），以便开始干活
8. 作为用户，我想让规划 AI 不断 `dispatch` 到同一个执行会话直到清单做完，以便上下文连续
9. 作为用户，我想清单全部完成后 Issue 自动进入待审核，以便知道可以开始收口
10. 作为用户，我想在待审核时继续跟规划 AI 说话，需要时再 dispatch 或开 E2E/code review 子代理，且状态保持待审核，以便没有「打回」这个概念
11. 作为用户，我想在规划会话里说「关掉/完成」或在 UI 点完成，把 Issue 标为已完成
12. 作为用户，我想在规划会话或 UI 取消未完成的 Issue，以便放弃
13. 作为用户，我想在侧栏「待办事项」里按 Issue 折叠看到规划会话和执行会话，以便从分组进对话
14. 作为用户，我想已完成/已取消的 Issue 不出现在待办事项分组，以便侧栏只留进行中的事
15. 作为用户，我想 Issue 与清单持久化到磁盘，重启不丢

## Implementation Decisions

### 实体与存储

Issue 字段：

| 字段 | 说明 |
|---|---|
| `id` | 稳定 id |
| `title` | 必填 |
| `description` | markdown，可空 |
| `priority` | `p0` \| `p1` \| `p2`，默认 `p1` |
| `tags` | `string[]`，trim、去空、去重、小写 |
| `status` | `pending` \| `planning` \| `executing` \| `review` \| `completed` \| `cancelled` |
| `workdir` | 打开规划时写入；未开规划可空 |
| `worktreeEnabled` | 打开规划时写入；git 仓库且为 true 时规划/执行会话走 worktree |
| `baseBranch` | 可选，worktree 的 base |
| `planningSessionId` | 懒创建后固定 |
| `executionSessionId` | 首次 dispatch 或「开始执行」时创建，之后固定 |
| `items` | `{ id, content, status: pending\|running\|done }[]` |
| `createdAt` / `updatedAt` | 毫秒时间戳 |

存储：`~/.muse-work/db/issues.json` 索引 + `~/.muse-work/db/issues/<id>/issue.json` 明细（含清单）。内存 Map + JSON 原子写，对齐 sessionStore。不用 SQLite。

对话创建的 Issue：`status=pending`，**不**沿用当前会话 workdir；打开规划时再选目录。

### 状态机

```
pending  --打开规划会话(选 workdir + worktree)-->  planning
planning --首次创建执行会话并 dispatch-->          executing
executing --items 全部 done-->                     review
review    --完成-->                                completed
任意未完成 --取消-->                               cancelled
```

硬约束：

- 没有 `rejected`、没有 `reviewing`、没有「审核不通过」。
- `review` 期间 `dispatch` **不改变** Issue 状态（仍为 `review`）；清单项可重新变 `pending/running`。
- `completed` / `cancelled` 为终态；完成前须 `status !== cancelled`。
- `pending` 可改标题/描述/优先级/标签；一旦 `planning` 及之后，workdir/worktree 不可改（改目录等于新 Issue）。
- 取消不删除会话文件；侧栏分组不再展示该 Issue。规划/执行会话仍可在工作空间里看到（不从 session 索引物理删除，除非用户手动删会话）。实现取舍：**取消/完成后从 grouped `issueGroups` 剔除**；会话本身不级联删除，避免误删聊天记录。

### Server

- REST：`/issues` CRUD、`PATCH` 元数据、`POST /issues/:id/cancel`、`POST /issues/:id/complete`、`POST /issues/:id/planning-session`、`POST /issues/:id/dispatch`、清单增删改。
- `POST planning-session`：body 含 `workdir`、`worktreeEnabled`、可选 `baseBranch`。创建规划会话（agent 场景 `issue-plan`，默认内置 `plan`），git+worktree 时按现有 desktop/session worktree 字段写入。成功后 `status=planning`。
- 执行会话：agent 场景 `issue-exec`，默认内置 `execute`；`permissionMode: bypassPermissions`；workdir/worktree 字段从 Issue（即规划会话）拷贝。
- `dispatch`：校验 Issue 未终态；确保执行会话存在；把 `itemId` 标 `running`；向执行会话 `sendMessage`（系统/规划来源标记，带清单项与指令）。执行 `onTurnSettled`：该项 `done` 或保持 `pending`（失败）；向规划会话注入进度（不打断：排队到当前回合结束）。`executing` 且全部 `done` → `review`。已是 `review` 则保持 `review`。
- 规划会话挂内置 plugin `issue`（始终开启，与 settings 开关无关）：脚本调上述 HTTP。
- Agent 场景扩展为 `session | popo | issue-plan | issue-exec`。设置页增加两行映射。内置 `plan`/`execute` 已存在，无需新 agent 定义。
- WS：`issue:changed` 广播刷新侧栏分组（所有 pane）。不单独做「待审核 toast」本期（人本来就在规划会话里聊）；YAGNI。

### Webview

- 侧栏「待办事项」section：按 Issue 分组（标题 + 优先级徽标 + 会话数）。组内：规划会话、执行会话（有则显示）。已完成/已取消不进分组。Issue 会话从「工作空间/任务」recent 剔除，避免重复。
- 新建：待办事项 section 头部「+」或菜单「新建 Issue」→ 对话框（标题/描述/优先级/标签）→ 创建后仍为待规划，点该组或「打开规划」再选 workdir + worktree 开关。
- 打开规划：目录选择器（复用 `desktopPickDirectory`）+ 「worktree 模式」开关（非 git 目录时开关无效并提示将直接在该目录执行）。
- Issue 行操作：完成、取消（确认）。点会话进入对应聊天。
- 不恢复旧 Todo 看板主视图。Issue 分组展开时只读展示清单勾选；改清单只走规划 AI 工具。
- 对话创建：普通会话也能挂 `issue` 插件，以便「建个 issue」。

### 规划 AI 工具（plugin 脚本）

| 工具意图 | 行为 |
|---|---|
| create | 对话里建 Issue（pending） |
| update | 改标题/描述/优先级/标签 |
| checklist set/add/complete | 改 `items` |
| dispatch | 对某 item 向执行会话发一轮 |
| complete | `status=completed`（须未取消；建议清单已全 done，但**不强制**——人可以说关就关） |
| cancel | `status=cancelled` |

执行会话**没有** complete/cancel Issue 的工具，避免执行 AI 自行关单。

### 子代理（待审核可选）

规划 skill 写明：待审核时根据清单与改动判断是否调用 E2E、code review 子代理；非强制；结论留在规划会话。不另开 Issue 状态。

## Testing Decisions

只测外部行为。

- Seam 1：Issue REST + 状态机（创建、规划会话、dispatch、全 done→review、review 下再 dispatch 仍为 review、complete/cancel、终态拒绝再 dispatch）
- Seam 2：dispatch → 执行回合结束 → 清单更新 + 规划会话注入
- Seam 3：侧栏 issueGroups 渲染、recent 剔除、完成/取消后分组消失
- Seam 4：plugin 脚本 create/dispatch/complete 打真实（或测服）HTTP

## 边界场景

- 规划会话未建：不能 dispatch。UI/对话仍可 complete 或 cancel（关掉刚登记、还没规划的 Issue）
- 执行回合失败：该项回到 `pending`，Issue 若在 `executing` 则保持 `executing`（未全 done）；若已在 `review` 保持 `review`
- 应用退出：执行中回合按现有 session interrupted 处理；Issue 状态不自动回退；重启后人不手动 dispatch 则不重跑
- 非 git + worktreeEnabled：创建规划会话时当作普通目录，不建 worktree
- 并发：同一执行会话串行（现有 runner 已按 session 串行）；全局不另设并发 3（只有一对会话，YAGNI）

## Out of Scope

- 旧 Todo/Task 看板、每 task 独立会话、FIFO 全局槽位
- POPO / 内部平台同步创建 Issue
- 审核不通过状态、强制 E2E/code review 才能完成
- 已完成归档页、看板拖拽
- 执行成功后自动删 worktree/执行会话（聊天要留着直到用户关 Issue 或手动删会话；关 Issue 本期也不删会话）

## Further Notes

- 领域词以 `CONTEXT.md` 为准
- worktree 创建走现有 session 的 worktree 字段 + desktop `createWorktree` 路径，规划会话创建 API 需与「新对话 worktree」同一套，避免第二套 git 实现
- 对话创建不预填 workdir，避免普通闲聊目录误绑到 Issue
