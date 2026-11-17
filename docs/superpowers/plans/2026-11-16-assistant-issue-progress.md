# 助手事项进展 Implementation Plan

> **For agentic workers:** 按 Task 顺序实现；每个 Task 先写失败测试，再改实现，再跑对应包的测试和 type-check。原型见 `docs/prototypes/assistant-progress.html`。

**Goal:** 让每个 Issue 有一条持久、可读的进展台账。助手在聊天里只发短回执/通知；用户不打开会话，也能在右侧「详情」看到最新进展、下一步、时间线、清单和产物；未读按 Issue 记，不按会话记。

**Architecture:** 每个 Issue 一个进展文件：`~/.muse-work/db/issue-progress/<issueId>.jsonl`，追加写、一行一条，读取时最新在前。写入点是助手 `SendMessage` 和 Issue 回合结束；助手的 Issue 归属来自被唤醒事件的 turn context，不靠 `at` 或上一条消息。`/sessions` 的 `issueGroups` 带最新若干条，继续用现有 `issue:changed` 刷新，不新增 WS 协议。Webview 详情读同一份数据；列表读 `latestUpdate`；未读用 localStorage 的 `seenAt`。聊天回执卡作为第二阶段，用 assistant turn id 分组，不阻塞 P0。

**Tech Stack:** TypeScript、Hono、React、Zustand/localStorage、Vitest。服务端 `packages/server`，webview `packages/webview`。

**交付切片：**

| 切片 | Task | 结果 |
| --- | --- | --- |
| P0 数据 | 1–5 | 每个 Issue 一个进展文件，`/sessions` 能拿到 |
| P0 阅读 | 7–10 | 详情、列表、未读、顶部 catch-up |
| P0 提示 | 13 | `next` 和短回执约束 |
| P1 历史 | 6 | 状态、清单、审批进展 |
| P1 聊天 | 11–12 | 按 Issue 折叠、本轮回执卡 |

---

## 谁写进展

**系统写为主，助手补一句；Issue 会话不需要额外调用工具，用户不写进展。**

| 来源 | 写入者 | 写什么 | 依赖模型自觉吗 |
| --- | --- | --- | --- |
| Issue 会话每轮结束 | 服务端 hook（`enqueueIssueSessionTurn`） | 回合结束模板、sessionId、状态、清单计数 | 否，自动 |
| 助手给事项发消息 | Muse Bot 的 `SendMessage`（显式 `issueId` 或单 Issue 回合 context） | 一句结论、`next`、文件、`messageId`、`turnId` | 是，但只是增强 |
| 状态 / 清单 / 审批 | Issue 状态机 / runner 事件 | 进入执行中、待审核、清单完成、等待批准 | 否，P1 自动 |
| 用户 | 只标已读、拍板 | 不改写进展；拍板结果由系统记录（P1） | 用户操作 |
| Webview | `issueSeen` | 只写 `seenAt`，不写进展 | 否 |

关键点：

- 助手忘了带 `issueId`，但这一轮只被一个 Issue 事件叫醒，仍然会归到那个 Issue；多事件回合不猜。就算完全没发消息，回合模板仍然在。
- Issue 会话（改代码的那个 agent）**不需要知道进展系统的存在**，也不需要调用 `ReportProgress` 之类的新工具。它的最后一条回复就是素材；服务端负责快照。
- 助手那一层只负责“把结论讲给人听”：一句摘要、下一步、附件。它不负责保证进度不丢。
- 用户不维护进展；用户只决定“这件事要不要继续 / 要不要拍板”。

下面的 Task 4 会同时覆盖单 agent 和 split 的执行会话，避免“执行会话干完了但规划会话还没转发，详情看不到”的空窗。

## 更新时机

**只在“一轮结束”和“助手真的说话”时写；不按 token、不按定时器、不在打开详情时写。**

| 时机 | 触发点 | 写什么 | 延迟 |
| --- | --- | --- | --- |
| 主路径 | Issue 会话一轮结束（`setOnTurnSettled`） | `turn`：回合结束模板（角色 + 清单计数），不读正文 | 回合结束后立刻；不执行中的中间步骤 |
| 补充 | Muse Bot 调 `SendMessage`（显式 `issueId` 或单 Issue context） | `assistant`：一句结论 + `next` + 文件 + `turnId` | 发消息时立刻 |
| P1 | 状态变化 / 清单项变化 / 审批请求 | `status` / `checklist` / `permission` | 状态真正变化时 |
| 不算更新 | 打开详情、切标签、点“已读” | 只写 `seenAt` | 不产生进展条目 |
| 不写 | 每个 token、每次工具调用、定时轮询 | 不写 | 避免时间线刷屏 |

顺序：

```text
Issue 回合结束
  → 读结构化状态（角色、清单计数、状态），生成 turn 模板
  → progress.append（先落盘）
  → broadcast issue:changed（详情/列表刷新）
  → 规划/单 agent 再 enqueue 给 Muse Bot（执行会话不 enqueue）

Muse Bot 发 SendMessage
  → progress.append（先落盘）
  → broadcast assistant:chat
```

边界：

- **回合没有文字结论**：仍然落模板（“执行回合结束 · 清单 2/5”）；详情显示模板 + “看这一轮”，不写空段落。
- **被中断/失败**：仍然落一条紧凑 `turn` 模板（如“执行回合中断 · 清单 2/5”）；不复制正文。要看结论点“看这一轮”，去 session transcript。P1 可以给 `turn` 加 `result: "ok" | "interrupted" | "error"`。
- **重试/重放**：`sourceKey` 去重（assistant 用 `messageId`，turn 用 `sessionId + lastMessageId`），不会重复追加。
- **用户正在看执行会话**：仍然落 `turn`，但带 `userPresent: true`，未读计数跳过。
- **长回合中途**：P0 不写进展；详情显示“正在运行 / 当前清单项”。要“当前在跑什么”属于 live activity，不是持久进展，P1 再考虑用 session 运行态补充，不把每个工具调用写进时间线。

---

## 非目标

- 不改 Issue 状态机、`issueDispatch` 的派发逻辑和会话 transcript 存储。
- 不把完整会话消息塞进事项详情；详情只存摘要、下一步、文件。
- 不替换现有会话级未读；会话状态点保留，Issue 进展未读是另一层。
- 不在 P0 做详情里的行内批准；审批卡片需要 permission 数据进 `issueGroups`，放 P1。
- 不重做助手消息存储；`turnId` 只是给消息加字段（P0 就需要，用于归属）。

---

## 设计决策

1. **一个 Issue 一个进展文件，不塞进 `issues.json`。**
   - 路径：`~/.muse-work/db/issue-progress/<issueId>.jsonl`，一行一条，追加写，最新在文件末尾。
   - `issues.json` 只保留 Issue 元数据，不再随进展变大；归档、列表、clone 都不被进展体量拖累。
   - JSONL 追加比整文件重写稳：进程崩在写一半，最多坏最后一行，读取时跳过。
   - 每个文件在内存里缓存最近 `30` 条；文件超过 `80` 行或 `256KB` 时压缩成最近 30 条，原子替换。
   - 单用户单进程，写入是同步的；不需要文件锁。多实例不是当前场景。

2. **P0 只记录「助手」和「回合」两类进展。**
   - 状态和清单已经由 `Issue.status` / `Issue.items` 展示，P0 不重复造状态历史。
   - 状态/清单/审批作为 P1 的 `kind` 扩展，不阻塞详情页上线。

3. **传输复用 `issue:changed`。**
   - 写入后广播 `issue:changed`，现有 host bridge 会刷新 `/sessions`。
   - 低频写入下这是最少的代码；如果刷新过于频繁，P1 增加带 payload 的 `issue:progress`，host 直接 patch，不整树刷新。

4. **未读是 Issue 级，存在客户端。**
   - 单机单用户，`localStorage` 足够；重启后仍在。
   - `seenAt` 只由「打开该 Issue 的详情/标签」或「全部已读」推进；打开会话也算看过。

5. **聊天不承载台账。**
   - P0 先修 `issueId` 归属和顶部 catch-up 条，保证漏看有安全网。
   - P1 再用 assistant turn id 把同轮多件事折成一张回执卡。

---

## 数据模型

### 文件布局

```text
~/.muse-work/db/
  issues.json
  issue-progress/
    0f3c2a....jsonl
    8b5e91....jsonl
```

- 一个 Issue 一个文件，一行一条 update。
- 文件内从旧到新追加；读取时反转成“最新在前”。
- `issueId` 只允许 `[A-Za-z0-9_-]`，防路径穿越；不合法直接拒绝。
- 关闭的 Issue 进展文件保留，不随归档删除。

### `packages/server/src/services/issueProgress.ts`（新增）

```ts
import type { IssueStatus } from "./issueStore.js";

export type IssueUpdateKind =
  | "assistant"
  | "turn"
  | "status"
  | "checklist"
  | "permission"
  | "result";

export interface IssueUpdate {
  id: string;
  /** 毫秒时间戳。 */
  at: number;
  kind: IssueUpdateKind;
  /** 一两句话，时间线直接显示。 */
  summary: string;
  /** 可选全文；只在展开时显示。 */
  detail?: string;
  sessionId?: string;
  /** 对应 assistant-messages 里的 line id，用于从详情跳到聊天。 */
  messageId?: string;
  /** turn 专用：这一轮最后一条 session 消息 id；和 messageId 不是一回事。 */
  sessionMessageId?: string;
  /** turn 专用：这一轮改动的代码文件，详情里点“查看代码”。 */
  changedFiles?: string[];
  files?: string[];
  /** 这一步的下一步，一句话。 */
  next?: string;
  /** 落这条时的 Issue 状态。 */
  status?: IssueStatus;
  /** 去重键：重试、重放不会重复追加。 */
  sourceKey?: string;
  /** assistant 本轮 id；P1 回执卡按它分组。 */
  turnId?: string;
  /** 用户正看着这个会话时产生，不计未读。 */
  userPresent?: true;
}

/** 写入时不能传 id / at；由 store 生成。 */
export type IssueUpdateInput = Omit<IssueUpdate, "id" | "at">;

export interface IssueProgressStore {
  append(issueId: string, input: IssueUpdateInput): IssueUpdate | undefined;
  list(
    issueId: string,
    opts?: { limit?: number; before?: string },
  ): { updates: IssueUpdate[]; hasMore: boolean };
  latest(issueId: string): IssueUpdate | undefined;
  /** 当前保留的条数；压缩后最多 30。 */
  count(issueId: string): number;
}

export function createIssueProgressStore(options: {
  home: string;
  now?: () => number;
  newId?: () => string;
}): IssueProgressStore;
```

约束：

- `ISSUE_UPDATE_LIMIT = 30`
- `ISSUE_UPDATE_COMPACT_AT = 80`
- `ISSUE_PROGRESS_MAX_BYTES = 262144`
- `ISSUE_UPDATE_SUMMARY_MAX = 280` 码点
- `ISSUE_UPDATE_DETAIL_MAX = 2000` 码点
- `ISSUE_UPDATE_FILES_MAX = 10`
- `at` 由服务端写，客户端不能传。
- `sourceKey` 已存在则返回已有那条，不重复追加。

实现要点：

- `append`：
  1. 校验 `issueId`，规范化 summary/detail/files。
  2. 读缓存（首次读该 Issue 文件）；有同 `sourceKey` 直接返回。
  3. 生成 `id` / `at`，`appendFileSync(path, JSON.stringify(update) + "\n")`。
  4. 缓存追加，`sourceKeys` 加入；缓存只保留最近 30 条。
  5. 如果文件行数超过 80 或字节超过 256KB，压缩成最近 30 条（临时文件 + rename 原子替换）。
  6. 返回 update 的 clone（`files` 复制）。
- `list`：从缓存取，按 `at` 倒序；`before` 按 id 过滤；`limit` 默认 30、最大 30；`hasMore = total > 返回数`。
- `latest`：缓存最后一条；`count`：当前保留条数。
- 读取：逐行 `JSON.parse`，坏行跳过；文件顺序不保证时按 `at` 排一次。
- 内存：`Map<issueId, { updates: IssueUpdate[]; total: number; sourceKeys: Set<string> }>`；文件小，缓存全量 30 条。
- 并发：单进程同步写；`appendFileSync` + 内存缓存足够。不做文件锁。

## 进展字段从哪来

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `id` | 服务端 | `append` 时生成 UUID。 |
| `at` | 服务端时钟 | `append` 的毫秒时间；不是回合开始时间。 |
| `kind` | 调用方 | `assistant` / `turn`；P1 的 `status` / `checklist` / `permission` / `result` 由状态变更点决定。 |
| `summary` | assistant：bot 的 `message`；turn：模板；status：模板 | assistant 去掉引用行和附件行，截 280；turn **不生成文本摘要**，只拼角色 + 清单计数（single 就是“回合结束”）。 |
| `detail` | assistant：`recordBody`（超过 280 时保留，最多 2000）；result：close note；permission：请求描述 | turn 不存正文；完整内容在 session transcript。 |
| `sessionId` | turn：`enqueueIssueSessionTurn` 的 `sessionId`；permission：事件里的 `sessionId` | assistant 消息默认不带；它用 `messageId` 定位聊天行。 |
| `messageId` | assistant：`log.append` 返回的 line id | 只用于跳回助手聊天。 |
| `sessionMessageId` | turn：最后一条 assistant session 消息的 id | 只用于“看这一轮”定位 transcript；和 `messageId` 不要混。 |
| `changedFiles` | turn：`lastTurnChangedFiles(messages)` | 这一轮实际改动的代码文件；点击打开 diff（没有 diff 时退回源码）。 |
| `files` | assistant：`SendMessage` 的 `files` | 本地文件绝对路径；turn/status 没有。 |
| `next` | assistant：`SendMessage` 的 `next` | 可选；UI 没有时退回第一条 pending/running 清单项。 |
| `status` | `recordIssueUpdate` 自动填 | 用 `issues.get(issueId).status`，保证落库时一致；`complete/cancel` 的 result 明确写 completed/cancelled。 |
| `sourceKey` | 调用方 | assistant：`assistant:<lineId>`；turn：`turn:<sessionId>:<lastMessageId>`；用于重试去重。 |
| `turnId` | assistant runtime context | 单 Issue/多 Issue 回合都带；turn update 没有 assistant turnId。 |
| `userPresent` | turn：`takeIssueUserPresent` | 用户正看着该会话；不计未读。assistant 更新不带。 |
| `latestUpdate` / `updates` / `updateCount` | `IssueProgressStore` | `latest` / `list(limit)` / `count`；`/sessions` 只带最近 8 条。 |
| 未读 | 客户端 `issueSeen` | `update.at > seenAt` 且不是 `userPresent`。 |
| `needsYou` | 派生 | `issue.status === "review"` / `awaiting_close`；P1 再加 permission update。 |
| 产物 | 派生 | 聚合 updates 的 `files`，去重。 |
| 清单 / 描述 / 目录 / 分支 | 现有 Issue 字段 | 不写进进展文件，详情直接读。 |

## `files` 怎么处理

`files` 只存**本地文件的绝对路径**，不存文件内容。

**写入时**（`SendMessage`）：

1. `args.files` 取字符串、去空白、去重，最多 10 个；超过直接失败，不静默丢。
2. 每个路径必须通过现有 `localFile()`：
   - 必须是绝对路径；
   - 必须存在且是普通文件；
   - 否则工具失败，不写聊天行、不写进展。
3. `recordBody = composeOutbound(message, [...links, ...files])` 仍把路径放进聊天正文，聊天里的文件 chip 逻辑不变。
4. `IssueUpdate.files` 只存去重后的绝对路径；不把 `links` 混进 `files`，链接仍留在聊天正文里（要作为产物就 P1 再加 `links` 字段）。

**展示时**（详情）：

- 产物 = 所有 updates 的 `files` 摊平、去重，保持首次出现顺序。
- 显示 `fileBaseName(path)`，`title` 放完整路径；点击走现有文件打开 / HTML 预览逻辑。
- 不在渲染时 `stat` 每个文件；点击时由 host 判断能否打开，打不开给 toast。
- 文件可能随 worktree 删除而失效：P0 保留历史路径，点击失败提示“文件可能已随 worktree 删除”；P1 可选把产物复制到 `~/.muse-work/artifacts/<issueId>/` 做长期保存。

**不做的**：

- 不把文件内容、base64、缩略图写进 `issue-progress/*.jsonl`。
- 不因为文件路径长就截断；JSONL 存原路径，UI 用 basename 展示。
- 不把 `files` 当作权限或安全边界；它只是路径记录。

### Task 1: 新增 `IssueProgressStore`

**Files:**
- Add: `packages/server/src/services/issueProgress.ts`
- Test: `packages/server/tests/issueProgress.test.ts`

**步骤：**

1. 先加失败测试：
   - 两个 Issue 各写一条，生成两个不同的 `<issueId>.jsonl` 文件。
   - 同一 Issue 追加两条，`latest` 是后一条，`list` 最新在前。
   - 重新 `createIssueProgressStore` 后还能读到。
   - 相同 `sourceKey` 不重复写；跨重启也不重复。
   - 超过 30 条只保留最近 30 条；超过 80 行触发压缩，文件仍可读。
   - 最后一行是坏 JSON 时跳过，不影响前面的记录。
   - 非法 `issueId`（含 `/`、`..`）被拒绝。
   - 没有文件时 `latest` 为 `undefined`、`count` 为 0。
2. 实现文件读写、缓存、去重、压缩、clone。
3. 跑 `pnpm -F @muse-work/server test -- issueProgress`。

**注意：** `issues.json` 完全不加 `updates` 字段；旧 Issue 无需迁移。

### Task 2: 统一写入入口 `recordIssueUpdate`

**Files:**
- Add: `packages/server/src/services/issueProgress.ts`（Task 1）
- Modify: `packages/server/src/services/appContext.ts`
- Modify: `packages/server/src/services/issueStore.ts`（只加 `touch`）
- Modify: `packages/server/src/services/assistant/tools/toolKit.ts`
- Test: `packages/server/tests/assistantWiring.test.ts`

`IssueStore` 增加一个只更新排序时间的 `touch`，不碰进展文件：

```ts
touch(id: string): Issue | undefined;
```

实现：`updatedAt = Date.now()`、`persist()`、返回 clone。

`appContext` 里创建进度 store 和统一写入入口：

```ts
const issueProgress = createIssueProgressStore({ home });

const recordIssueUpdate = (
  issueId: string,
  input: IssueUpdateInput,
): IssueUpdate | undefined => {
  const issue = issues.get(issueId);
  if (!issue) return undefined;
  if (issue.status === "completed" || issue.status === "cancelled") {
    return undefined;
  }

  const update = issueProgress.append(issueId, {
    ...input,
    status: input.status ?? issue.status,
  });
  if (!update) return undefined;

  // 只改 issues.json 里的 updatedAt，不把进展写进去。
  issues.touch(issueId);
  sessions.hub.broadcastAll({ type: "issue:changed" });
  return update;
};
```

放在 `sessions` 创建之后、`assistantTools` 创建之前。把它传给：

- `createAssistantTools({ ..., recordIssueUpdate })`
- `enqueueIssueSessionTurn({ ..., recordIssueUpdate })`
- `enqueueIssuePermission({ ..., recordIssueUpdate })`（P1）

`AppContext` 增加 `issueProgress: IssueProgressStore` 和 `recordIssueUpdate`，供 `/sessions`、`/issues/:id/updates` 和 P1 的状态变更点使用。

`AssistantToolDeps` 增加：

```ts
// toolKit.ts 从 issueProgress.ts import type { IssueUpdate, IssueUpdateInput }
recordIssueUpdate?: (
  issueId: string,
  input: IssueUpdateInput,
) => IssueUpdate | undefined;
```

测试里用 spy 捕获调用，不依赖真实 hub；另测 `append` 后 `issues.json` 里没有 `updates` 字段、只有 `updatedAt` 变化。

### Task 3: 用 assistant turn context 归属，不靠 `at` 也不靠上一条

**Files:**
- Modify: `packages/server/src/services/assistant/runtime.ts`
- Modify: `packages/server/src/services/appContext.ts`
- Modify: `packages/server/src/services/assistant/tools/messageTools.ts`
- Modify: `packages/server/src/services/assistant/tools/toolKit.ts`
- Modify: `packages/server/src/services/assistant/messages.ts`
- Test: `packages/server/tests/assistantRuntime.test.ts`
- Test: `packages/server/tests/assistantTools.test.ts`

现实：Muse Bot 一个回合经常连续调多次 `SendMessage`，只有第一条带 `ats`；靠“第一条 @ 了哪个”或“上一条是哪个”都不稳定。**归属应该来自这一轮是被什么事件叫醒的，而不是消息文本。**

#### 运行层：每轮一个 turn context

`createAssistantRuntime` 在 `beginTurn(batch)` 生成：

```ts
type AssistantTurnContext = {
  turnId: string;
  eventCount: number;
  issueIds: string[];
  /** 只有“这一轮只被一个 issue/permission 事件叫醒”时才有值。 */
  singleIssueId?: string;
};
```

计算：

```ts
const issueIds = [...new Set(
  batch.flatMap((event) =>
    event.type === "issue" || event.type === "permission"
      ? [event.issueId]
      : [],
  ),
)];

const singleIssueId =
  batch.length === 1 && issueIds.length === 1 ? issueIds[0] : undefined;
```

- `beginTurn` 调 `options.onTurnStart?.({ turnId, eventCount: batch.length, issueIds, singleIssueId })`。
- `onAssistantTurnSettled` 调 `options.onTurnEnd?.(turnId)` 清空。
- `turnId` 用 `crypto.randomUUID()`；`MuseChatLine` / `AssistantLine` / `IssueUpdate` 都带 `turnId`。

#### 工具层：解析 issueId

`appContext` 保存 `currentAssistantTurn?: AssistantTurnContext`，通过 `getTurnContext` 传给 `createAssistantTools`。

`SendMessage`：

```ts
const explicitIssueId = text(args.issueId);
if (args.issueId !== undefined && !explicitIssueId) {
  return fail("issueId required");
}

const turn = deps.getTurnContext?.();
// 单 Issue 回合：后续消息自动继承；多事件回合不猜，必须显式传。
const issueId = explicitIssueId || turn?.singleIssueId;

const issue = issueId ? deps.issues.get(issueId) : undefined;
if (explicitIssueId && !issue) {
  return fail("issue not found; call ListIssues first");
}
if (issue && (issue.status === "completed" || issue.status === "cancelled")) {
  return fail("issue is closed");
}

// ...message/files/links validation, composeOutbound

const line = deps.log.append(
  "assistant",
  recordBody,
  undefined,
  undefined,
  undefined,
  issueId,
  turn?.turnId,
);

if (issueId && deps.recordIssueUpdate) {
  deps.recordIssueUpdate(issueId, {
    kind: "assistant",
    summary: issueUpdateSummary(message) || "更新了进展",
    detail: [...recordBody].length > 280 ? recordBody : undefined,
    messageId: line.id,
    files,
    next: text(args.next) || undefined,
    turnId: turn?.turnId,
    sourceKey: `assistant:${line.id}`,
  });
}

if (issueId) deps.issues.clearReplyPending(issueId);
deps.hub.broadcastAll({ type: "assistant:chat", line });
return ok({ line });
```

规则：

- **单 Issue 回合**：这一轮只被一个 issue（或 permission）事件叫醒。第一条消息可以不写 `issueId`，后续也不用重复；整轮消息都归这个 Issue。
- **多事件回合**：这一轮同时处理多件事，或 issue + chat 混在一起。`singleIssueId` 为空，**不自动归属**；每条要写进展的消息必须显式带 `issueId`。不传就只发聊天，不写进展。
- **聊天回合**：没有被 issue 事件叫醒，没有 context；普通聊天。
- `ats` 只用于引用/展示，不写进展；`previousIssueId` 不再参与归属。
- 显式传了 `issueId` 就必须有效、未关闭，否则失败；不会静默退回上一条。
- `next` 只在有 issue 归属时写。

`MuseChatLine` / `AssistantLine` 增加 `turnId?: string`；`IssueUpdate` 已有 `turnId`。这样 P1 回执卡可以直接按 `turnId` 分组，不用再推断。

**测试：**
- 单 Issue 事件唤醒的回合，连续 3 次 `SendMessage` 都不带 `issueId`：3 条都归同一个 Issue，`line.turnId` 相同，写 3 条 update。
- 第一条显式 `issueId`、后续不带：后续继承同一 Issue。
- 一个 issue + 一个 chat 的批次：`singleIssueId` 为空；不带 `issueId` 的消息只写聊天，不写进展。
- 两个 issue 的批次：`singleIssueId` 为空；不显式传就不写进展，不会串到任意一条。
- 显式 `issueId` 不存在 / 已关闭 → 失败，不写聊天行、不写 progress。
- `ats` 不产生进展；`previousIssueId` 不参与。
- `turnId` 随消息和 update 落盘，重试同一条 `sourceKey` 不重复。

### Task 4: Issue 回合结束写一条系统标记（规划 + 执行都覆盖）

**Files:**
- Modify: `packages/server/src/services/assistant/observe.ts`
- Modify: `packages/server/src/services/appContext.ts`
- Test: `packages/server/tests/assistantWiring.test.ts`

`enqueueIssueSessionTurn` 增加可选参数：

```ts
recordIssueUpdate?: (issueId: string, input: IssueUpdateInput) => IssueUpdate | undefined;
```

当前函数只找 `planningSessionId === sessionId` 的 Issue，执行会话的回合不会直接落进展；要改成“规划会话写进展并唤醒助手，执行会话只写进展、不唤醒助手”：

```ts
const planningIssue = args.issues
  .listActive()
  .find((item) => item.planningSessionId === args.sessionId);
const executionIssue = planningIssue
  ? undefined
  : args.issues
      .listActive()
      .find((item) => item.executionSessionId === args.sessionId);
const issue = planningIssue ?? executionIssue;
if (!issue?.workdir) return;

// ...read messages, request, userPresent

const lastText = lastAssistantText(messages);
const lastId = lastAssistantMessageId(messages);
const done = issue.items.filter((item) => item.status === "done").length;
const total = issue.items.length;
const turnSummary = [
  planningIssue ? "回合结束" : "执行回合结束",
  total > 0 ? `清单 ${done}/${total}` : "",
].filter(Boolean).join(" · ");

if (args.recordIssueUpdate) {
  args.recordIssueUpdate(issue.id, {
    kind: "turn",
    summary: turnSummary,
    sessionId: args.sessionId,
    sessionMessageId: lastId,
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    status: issue.status,
    userPresent: userPresent ? true : undefined,
    sourceKey: lastId ? `turn:${args.sessionId}:${lastId}` : undefined,
  });
}

// 执行会话到此为止：它不负责给用户发消息，也不改 replyPending。
if (!planningIssue) return;

// 规划/单 agent 继续原来的逻辑
const pending = args.issues.markReplyPending(issue.id) ?? issue;
args.enqueue({
  type: "issue",
  issueId: issue.id,
  title: issue.title,
  workdir: issue.workdir,
  ...(request ? { request } : {}),
  summary: lastText,
  replyPending: true,
  ...(userPresent ? { userPresent: true as const } : {}),
  ...(pending.replyNote ? { replyNote: pending.replyNote } : {}),
});
```

`lastAssistantMessageId` 从消息数组里取最后一个 `role === "assistant"` 的 `id`；没有 id 时不生成 `sourceKey`（允许追加一次，重试可能重复，低频可接受）。`clip` 按码点截断，复用现有的 `truncateCodePoints` / `compactText` 实现，不要用 `slice` 切 emoji。

**single 模式没有清单：** 模板就是“回合结束”，它只是一个系统标记，不是结论。真正的进展来自同轮的 `assistant` 消息；没有消息就点“看这一轮”去 session，不伪造文本摘要。

**为什么执行会话也要写：**
- split 模式下，执行会话可能连续跑几轮；如果只等规划会话转发，详情在执行期间是空的。
- 执行会话的模板至少告诉你“执行跑完了一轮、清单到哪了”，比没有进展有用。
- 执行会话不 `enqueue` assistant 事件，所以不会额外唤醒 Muse Bot，也不会多一条聊天消息。

**重复问题：** 同一个回合会先写一条紧凑的 `turn`，助手随后用 `SendMessage` 写 `assistant`。`turn` 只显示“回合结束 · 清单 2/5”这种系统行，不显示长篇正文；有 `assistant` 跟随时，详情默认不再展示这条 `turn`。P1 再用 `turnId` 合并。不要为了去重把 `turn` 删掉——它是 `single` 模式和执行会话唯一的兜底记录。

**测试：**
- 规划会话回合：写 `turn`，并照常 `enqueue` issue 事件。
- 执行会话回合：写 `turn`，但**不** `enqueue` issue 事件、不 `markReplyPending`。
- `userPresent` 的执行会话回合：update 带 `userPresent: true`。
- 空 summary：不写 update。

### Task 5: `/sessions` 暴露 `latestUpdate` 和最近 updates

**Files:**
- Modify: `packages/server/src/routes/sessions.ts`
- Test: `packages/server/tests/sessions.routes.test.ts`

`toGroup` 从 `ctx.issueProgress` 读，不再读 Issue 字段：

```ts
const progress = closed
  ? { updates: [], updateCount: 0, latestUpdate: undefined }
  : {
      latestUpdate: ctx.issueProgress.latest(issue.id),
      updates: ctx.issueProgress.list(issue.id, { limit: 8 }).updates,
      updateCount: ctx.issueProgress.count(issue.id),
    };
return {
  // ...existing
  ...(progress.latestUpdate ? { latestUpdate: progress.latestUpdate } : {}),
  ...(progress.updates.length > 0 ? { updates: progress.updates } : {}),
  ...(progress.updateCount > 0 ? { updateCount: progress.updateCount } : {}),
};
```

约束：

- `latestUpdate` 可为 `undefined`，没有进展的 Issue 不显示进展区。
- `updates` 最多 8 条，避免 `issueGroups` 载荷过大。
- 关闭的 Issue 默认不带 `updates`（`closed` 分支），避免历史包体膨胀；需要看历史时走单 Issue 接口。
- `issue:changed` 已经在写入入口广播；`/sessions` 刷新后列表/详情自动拿到新数据。
- 新增 `GET /issues/:id/updates?limit=&before=`，返回 `{ updates, hasMore }`，直接调用 `ctx.issueProgress.list`；详情以后要“查看全部”时不用再读整棵树。

载荷示例：

```json
{
  "issueId": "8b5e...",
  "title": "同页一致性",
  "status": "executing",
  "priority": "p1",
  "latestUpdate": {
    "id": "u-2",
    "at": 1763283120000,
    "kind": "assistant",
    "summary": "输入框 42/32 已统一到 32px，共改 5 处；报告已出。",
    "next": "还剩按钮高度、编辑/停用边框、token 收口。",
    "messageId": "chat-line-id",
    "files": ["/Users/.../迭代链路-同页一致性-2026-11-16.html"]
  },
  "updates": [
    { "id": "u-2", "at": 1763283120000, "kind": "assistant", "summary": "输入框 42/32 已统一到 32px。" },
    { "id": "u-1", "at": 1763283000000, "kind": "turn", "summary": "执行会话完成首轮。" }
  ],
  "updateCount": 2
}
```

**测试：**
- 创建 Issue 并用 `ctx.issueProgress.append` 写两次，`GET /sessions` 的 `issueGroups[0]` 有 `latestUpdate` 和 2 条 `updates`。
- 旧 Issue 没有 updates 时字段为 `undefined`，不破坏现有断言。
- 关闭后 `closedIssueGroups` 不带 updates；`GET /issues/:id/updates` 仍能读到历史。

### Task 6: 状态/清单/审批进展（P1）

**Files:**
- Modify: `packages/server/src/services/appContext.ts`（把 `recordIssueUpdate` 注入状态变更点）
- Modify: `packages/server/src/routes/issues.ts`（complete / cancel / ready）
- Modify: `packages/server/src/services/issueDispatch.ts`（执行中 / 待审核；通过注入的 `recordIssueUpdate`）
- Modify: `packages/server/src/services/assistant/observe.ts`（permission）
- Test: `packages/server/tests/issueProgress.test.ts`、`assistantWiring.test.ts`、`issues.routes.test.ts`

不要把文案硬编码进 `IssueStore` 的每个方法；在已有 `broadcastAll({ type: "issue:changed" })` 的状态变更点调用 `recordIssueUpdate`：

- `markExecuting` → “进入执行中”
- `maybeEnterReview` → “清单完成，进入待审核”
- `markReady` → “这一轮做完，等你确认”
- `complete` → **在状态变终态、归档之前**写 `kind: "result"`，`summary: "已完成：..."`，`detail: note`
- `cancel` → 同样在归档前写 `kind: "result"`，`summary: "已取消：..."`，`detail: note`
- `enqueueIssuePermission` → `kind: "permission"`，`summary: "等待批准：<toolName>"`，`detail: description`

`complete` / `cancel` 必须先写 result 再归档，因为 `recordIssueUpdate` 默认拒绝终态 Issue；这样不用给写入入口加 `allowClosed` 分支。

清单变更只记**状态变化**（item 从 pending → running → done），不记每次编辑，避免时间线刷屏。

---

## Webview 数据流

### Task 7: 类型和 host bridge 透传

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`
- Modify: `packages/webview/src/types/index.ts`
- Modify: `packages/webview/src/muse/hostBridge/session.ts`
- Test: `packages/webview/tests/muse/hostBridge.test.ts`

增加 webview 侧 `MuseIssueUpdate`，字段与服务端一致：

```ts
export interface MuseIssueUpdate {
  id: string;
  at: number;
  kind: "assistant" | "turn" | "status" | "checklist" | "permission" | "result";
  summary: string;
  detail?: string;
  sessionId?: string;
  messageId?: string;
  sessionMessageId?: string;
  files?: string[];
  next?: string;
  status?: MuseIssueStatus;
  turnId?: string;
  userPresent?: true;
}
```

`MuseIssue` / `MuseIssueGroup` 增加：

```ts
updates?: MuseIssueUpdate[];
latestUpdate?: MuseIssueUpdate;
updateCount?: number;
```

`DesktopIssueGroup` 同样增加这三个可选字段。

`emitSessionTree` 的 `issueGroups.map` 显式带上：

```ts
...(g.latestUpdate ? { latestUpdate: g.latestUpdate } : {}),
...(g.updates ? { updates: g.updates } : {}),
...(g.updateCount !== undefined ? { updateCount: g.updateCount } : {}),
```

`applyGrouped` 是展开合并，字段会自动保留；不要只写白名单漏掉。

**测试：** `desktopSessionTree` 的 payload 里有 `latestUpdate` / `updates`。

### Task 8: `DockDetail` 变成进展页

**Files:**
- Modify: `packages/webview/src/components/desktop/DockDetail.tsx`
- Modify: `packages/webview/src/styles/DesktopPanelDock.css`
- Test: `packages/webview/tests/components/dockDetail.test.tsx`

渲染顺序：

1. 标题 / 状态 / 优先级 / 最近更新时间
2. `待你处理`（仅 `status === "review"` 或 `awaiting_close`，或 P1 permission update）
3. `最新进展`：优先最新 `assistant` / `result`；没有时用最新 `turn.summary`（模板）；再没有用状态文案
4. `下一步`：最新 `assistant` 的 `next`，否则第一条 `pending/running` 清单项，否则不显示
5. `进展` 时间线：`updates.slice(0, 8)`，`turn` 行只显示“执行回合结束 · 清单 2/5”这种紧凑系统行
6. `执行清单`（保留现状）
7. `产物`：聚合 `updates.flatMap(files)`，去重，显示文件 chip
8. 描述 / 工作目录 / 分支（放在后面，保持可查）

**`turn.summary` 是模板，不是文本摘要。** 规则：

- 由结构化状态拼出来：`执行回合结束 · 清单 2/5`、`规划回合结束`、`执行回合中断 · 清单 2/5`。
- 不读、不截断、不复制最后一条 assistant 文本；文本结论只来自 `assistant`。
- 没有 `assistant` 时，详情显示这个模板 + “看这一轮”；完整结论点进 session 看。
- 完整过程点“打开会话”，不在详情里复制 transcript。

没有 updates 时：

- 不显示空时间线。
- 保留现有描述 + 清单 + 环境字段。
- 在「执行清单」上方给一句低对比提示：“这一轮结束后，进展会出现在这里。”

`Kind` 标签：

```ts
const UPDATE_KIND_LABEL: Record<IssueUpdateKind, string> = {
  assistant: "助手",
  turn: "回合",
  status: "状态",
  checklist: "清单",
  permission: "待批准",
  result: "结果",
};
```

`待你处理` 的按钮 P0 只做“打开会话”，不做行内批准；行内批准需要把 permission 数据带进 `issueGroups`，放 P1。

**测试：**
- 有 `assistant`：最新进展用 assistant，`turn` 只渲染成紧凑系统行，不重复长文。
- 只有 `turn`：显示 `turn.summary` 模板和“看这一轮”，不显示截断文本。
- 有 updates：显示下一步、时间线、产物。
- 无 updates：不显示空时间线，旧字段仍在。
- `status === "review"`：显示待你处理。
- `single` 且无清单：不再是一片空白，至少显示最新进展。

### Task 9: Issue 未读和列表摘要

**Files:**
- Add: `packages/webview/src/muse/issueSeen.ts`
- Modify: `packages/webview/src/hooks/useBotIssueBoard.tsx`
- Modify: `packages/webview/src/components/desktop/BotLists.tsx`
- Modify: `packages/webview/src/components/desktop/BotLists.css`
- Test: `packages/webview/tests/components/botLists.test.tsx`

`issueSeen.ts`：

```ts
const KEY = "muse.issue-seen.v1";

type SeenMap = Record<string, number>;

export function readIssueSeen(): SeenMap;
export function markIssueSeen(issueId: string, at?: number): void;
export function markIssuesSeen(issueIds: readonly string[], at?: number): void;
export function useIssueSeen(): SeenMap; // useSyncExternalStore
```

- 写入 `localStorage`；读写失败静默。
- 监听 `storage` 事件，多窗口同步。
- `markIssueSeen` 取 `Math.max(existing, at ?? Date.now())`。

`useBotIssueBoard`：

```ts
const seen = useIssueSeen();
const seenAt = seen[group.issueId] ?? 0;
const isUnread = (update: MuseIssueUpdate) =>
  !update.userPresent && update.at > seenAt;

const latest = group.latestUpdate;
const unreadCount = (group.updates ?? []).filter(isUnread).length;
return {
  ...item,
  latestUpdate: latest,
  unreadCount,
};
```

- `userPresent` 的更新不计未读：用户正看着那个会话，回合结束不该再亮红点。
- `unreadCount` 用可见的 `updates` 计算；超过 8 条时 UI 可以显示 `8+`，P0 直接显示数字。
- 选中 Issue / 打开标签时 `markIssueSeen(issueId)`：
  - `selectBotPanel` 里。
  - `useEffect` 监听 `workspace.panel` 和 `workspace.active`，当是 Issue 时补一次。
- `botIssues` 仍按 `listActive` 的服务端顺序（先优先级、再 `updatedAt`），P0 不改排序；列表上的摘要和时间足够表达“刚发生了什么”。如果后续要“最新优先”，单独加排序开关，不和进展数据耦合。

`BotLists`：

- `BotListIssue` 增加 `latestUpdate?: { summary: string; at: number }`、`unreadCount?: number`。
- 行从单行改成两行：
  - 第一行：类型图标 + 标题 + 未读 badge + 时间
  - 第二行：`latestUpdate.summary`，截断；没有就退回 `statusLabel`
- 现有 `presence`（running/waiting）继续保留在图标上；未读 badge 是 Issue 进展的蓝点/数字，两者不冲突。

**测试：**
- 有 `latestUpdate` 时显示摘要和相对时间。
- `latestUpdate.at > seenAt` 显示未读；点击后消失。
- 无 updates 时仍显示状态文案。
- `localStorage` 持久化。

### Task 10: Assistant 顶部 catch-up 条

**Files:**
- Modify: `packages/webview/src/components/assistant/AssistantPage.tsx`
- Modify: `packages/webview/src/components/assistant/AssistantFrame.tsx`
- Modify: `packages/webview/src/components/desktop/BotTabs.tsx`
- Modify: `packages/webview/src/styles/AssistantPage.css`
- Test: `packages/webview/tests/components/assistantPage.test.tsx`
- Test: `packages/webview/tests/components/botTabs.test.tsx`

新 props：

```ts
type AssistantProgressItem = {
  issueId: string;
  title: string;
  unread: number;
  summary?: string;
  at?: number;
};

progressItems?: AssistantProgressItem[];
onOpenProgressIssue?: (issueId: string) => void;
onMarkAllProgressRead?: () => void;
```

`AssistantPage` 在 `assistant-queue` 和聊天列表上方渲染一个 sticky 条：

```tsx
{progressItems.length > 0 ? (
  <section className="assistant-catchup" aria-label="未读进展">
    <span className="assistant-catchup-dot" />
    <span className="assistant-catchup-label">
      有 {progressItems.length} 件事有新进展
    </span>
    {progressItems.map((item) => (
      <button onClick={() => onOpenProgressIssue?.(item.issueId)}>
        {item.title}
        <span>{item.unread}</span>
      </button>
    ))}
    <button onClick={onMarkAllProgressRead}>全部已读</button>
  </section>
) : null}
```

`AssistantFrame` 从 `board.botIssues` 过滤 `unreadCount > 0`，传进去；`onMarkAllProgressRead` 调 `markIssuesSeen(ids)`。

行为：

- 点击某一条 → 调用 `selectBotPanel({ kind: "issue", issueId })`，右侧详情打开，同时 `markIssueSeen`。
- 点“全部已读” → 只把当前这些 Issue 标为已读，不影响之后的新更新。
- 在 `transcript` 模式也显示？P0 只在 `chat` 模式显示，避免轨迹页干扰。
- **在 Issue 标签页时 catch-up 条不可见**：`BotTabs` 增加 `progressUnread?: boolean`，`AssistantFrame` 传 `board.botIssues.some((item) => item.unreadCount > 0)`；`botUnread` 与现有 `useAssistantNotice().unread` 取 OR，保证后台来的进展在「灵光」标签上有一个点，不抢当前会话。
- `AssistantFrame` 的 `BotTabs` 在 issue scope（三栏/独立 issue 标签栏）也要传同一个 `progressUnread`，否则窄布局下信号会丢。

**测试：** 3 条未读显示 3 个 chip；点一个后只剩 2 个；全部已读后消失。

### Task 11: 聊天 issueId 连续性 + 分组（P1）

**Files:**
- Modify: `packages/server/src/services/assistant/tools/messageTools.ts`（已经在 Task 3）
- Modify: `packages/webview/src/components/assistant/AssistantPage.tsx`
- Add: `packages/webview/src/components/assistant/AssistantIssueThread.tsx`
- Test: `packages/webview/tests/components/assistantPage.test.tsx`

P0 已完成归属；P1 才做视觉折叠：

- `buildAssistantRows(lines)`：连续 `assistant` 且 `issueId` 相同的行合成一组；组渲染最新一条 + “还有 N 条更新”折叠。
- 单条更新的消息保持原样；不要把所有消息都塞进卡片。
- 未读分隔线：以 `lastSeenAssistantLineId` 为界，显示“以下为新进展”。这个状态可以复用 `issueSeen` 或单独存 assistant 页的 `lastReadAt`。

### Task 12: 本轮回执卡（P1，UI 分组）

**Files:**
- Modify: `packages/webview/src/components/assistant/AssistantPage.tsx`
- Add: `packages/webview/src/components/assistant/AssistantTurnReceipt.tsx`
- Test: `packages/webview/tests/components/assistantPage.test.tsx`

Task 3 已经在运行层生成 `turnId`，并写进 `MuseChatLine` / `AssistantLine` / `IssueUpdate`。这个 Task 只做 UI，不再改服务端。

1. `buildAssistantRows` 按 `turnId` 分组；同一轮里 `assistant` update 的 Issue 数 ≥2 时，合成 `AssistantTurnReceipt`。
2. 回执行：
   - 标题：`本轮结果 · HH:MM`
   - 每行：Issue 标题 + 状态 + 该 Issue 在本轮的最后一条 `assistant.summary` + “看进展”
   - 点行 → 打开右侧详情
   - 原始长文默认折叠；需要时展开。
3. 同一 Issue 在本轮有多条消息：行上显示最后一条 + “还有 N 条”，不重复铺开。
4. 少于 2 个 Issue 的回合不生成回执，保持普通气泡。
5. 回执只由 `assistant` update 组成；`turn` update 是系统标记，没有 `turnId`，不塞进回执。

**测试：** 一轮 3 个 Issue / 5 条消息 → 1 张回执、3 行；同 Issue 两条 → “还有 1 条”；单 Issue 回合不生成回执。

### Task 13: 提示词和 `next`

**Files:**
- Modify: `packages/server/src/services/assistant/prompt.ts`
- Modify: `packages/server/src/services/assistant/tools/messageTools.ts`
- Test: `packages/server/tests/assistantTools.test.ts`（schema/next）

`SendMessage` 增加可选 `next`（有 issue 归属时生效），提示词在 `1.4 事项一轮结束` 补：

```text
单 Issue 叫醒的回合，SendMessage 不必每条重复 issueId；这一轮的消息会归到那个 Issue。
一次 batch 有多件事（多个 issue，或 issue + chat）时，每条要写进展的消息必须带 issueId；
不知道 id 就先 ListIssues 或问用户，不要猜，不要拿 ats 当归属。
尽量用 next 写一句下一步。细节写进事项进展，不要贴会话原文。
普通聊天不要带 issueId；一次叫醒处理多件事，先发一条汇总，
再分别用一句话更新事项；不要连发多段长文。
```

同时保留现有规则：短、结论先行、不要复述。

**不要**让提示词要求每条消息都写 `next`；没有下一步就省略。

`ats` 只用于引用/展示，不写进展。单 Issue 回合的归属来自 turn context，不来自 `ats`。

---

## 测试计划

### 服务端

```bash
pnpm -F @muse-work/server test -- issueProgress
pnpm -F @muse-work/server test -- issueStore
pnpm -F @muse-work/server test -- issues.routes
pnpm -F @muse-work/server test -- assistantTools
pnpm -F @muse-work/server test -- assistantWiring
pnpm -F @muse-work/server test -- sessions.routes
pnpm -F @muse-work/server type-check
```

新增/更新用例：

- `issueProgress.test.ts`：一 Issue 一文件、append/list/latest/count、去重、重载、压缩、坏行、非法 id。
- `issueStore.test.ts`：`touch` 只改 `updatedAt`，不写进展字段。
- `assistantRuntime.test.ts`：单 Issue 事件批次生成 `singleIssueId`；多事件批次为空；`turnId` 开始/结束清理。
- `assistantTools.test.ts`：单 Issue 回合多次 `SendMessage` 不重复写 issueId 也归同一 Issue；多事件回合不显式传就不写；显式 id 缺失/关闭 Issue 失败；`ats` 不写。
- `assistantWiring.test.ts`：issue turn 写 update；`userPresent` 标记；空 summary 不写。
- `sessions.routes.test.ts`：`latestUpdate` / `updates` / `updateCount`；没有进展文件时字段省略。
- `issues.routes.test.ts`：`GET /issues/:id/updates` 返回历史，关闭后仍可读。

### Webview

```bash
pnpm -F @muse-work/webview test -- dockDetail
pnpm -F @muse-work/webview test -- botLists
pnpm -F @muse-work/webview test -- assistantPage
pnpm -F @muse-work/webview test -- hostBridge
pnpm -F @muse-work/webview type-check
```

新增/更新用例：

- `dockDetail.test.tsx`：最新进展/时间线/下一步/产物；无 updates 回退；review 的待你处理；single 无清单。
- `botLists.test.tsx`：摘要、时间、未读 badge、点击清除。
- `assistantPage.test.tsx`：catch-up 条、点击 chip、全部已读。
- `hostBridge.test.ts`：`issueGroups` 透传 updates。
- `issueSeen` 的小单测：读写、取 max、storage 同步。

### 全量

```bash
pnpm test
pnpm type-check
```

---

## 实施顺序

1. **Task 1–2**：新增 `IssueProgressStore` + `recordIssueUpdate`。先让每个 Issue 有独立进展文件，UI 不变。
2. **Task 3–4**：`SendMessage` / 回合结束写进展。用 `db/issue-progress/<issueId>.jsonl` 和 `GET /issues/:id/updates` 手工验证。
3. **Task 5**：`/sessions` 载荷。此时 host 能收到，但 UI 还没用。
4. **Task 7–8**：webview 类型 + 详情页。这是第一个可见收益：不打开会话能看进展。
5. **Task 9–10**：未读 + catch-up 条。解决“漏看”的安全网。
6. **Task 11–12**：聊天分组 + 回执卡。解决“一串内容”。
7. **Task 13**：提示词收口。避免模型继续把长文塞进聊天。

每个 Task 单独提交；Task 1–5 可以在 UI 未上线时先合入，不影响现有行为。

---

## 验收标准

- 单 Issue 事件唤醒的回合里，助手连续发多条 `SendMessage`（只有第一条带 `at` 或都不带）都归到同一 Issue；刷新/重启后详情仍能看到。
- 多事件回合里没带 `issueId` 的消息不会误挂到任意 Issue；宁可不写，也不写错。
- `single` 模式（无清单）的事项，详情展示 bot 的 `assistant` 消息；没有消息时显示“回合结束”标记 + “看这一轮”，不伪造摘要。
- 三件事同时有进展时，助手页顶部显示 3 个未读 chip；点其中一个只清那一条，其余还在。
- 在 Issue 会话里产生的新进展，不抢当前正在看的会话；「灵光」标签出现未读点。
- 同一个 Issue 的后续消息即使没有重复 `@`，也归到该 Issue；超过 30 分钟不再误挂。
- split 模式下，执行会话每轮结束就有进展，不依赖规划会话转发；规划会话的回合仍会多一条 `turn`，P1 合并。
- 没有进展文件的 Issue 正常启动，详情退回旧布局；`issues.json` 里不出现 `updates`。
- 关闭 Issue 后进展文件仍在；关闭列表不带 updates，但 `GET /issues/:id/updates` 还能读到历史。

---

## 兼容与回滚

- 新目录 `db/issue-progress/` 是纯增量；旧 webview / 旧 host 不读它，照常工作。
- `issues.json` 的 `version` 不变，也不新增字段；进展只写 `db/issue-progress/`。
- 关闭 Issues 的进展文件保留，旧代码忽略该目录。
- UI 回滚只撤详情/列表/catch-up 组件，服务端数据留着；再次上线时直接复用。
- 如果进展文件占用异常，先降 `ISSUE_UPDATE_LIMIT` / 触发压缩，不影响 `issues.json` 和 Issue 状态。
- 可选：启动时清理 `issue-progress/` 里找不到对应 Issue 的孤儿文件；P0 不做，保留数据更安全。

---

## 风险与取舍

- **文件数量变多**：一个 Issue 一个文件，关闭后仍保留；本地几百到几千个小文件没问题。若担心 inode，按 `issueId` 前缀分两级目录，接口不变。
- **单文件变长**：每 30 条保留、80 行/256KB 压缩；异常长也不会拖慢列表。
- **进展与 Issue 元数据分离**：`issues.json` 只改 `updatedAt`，不会因为进展详情变大而变慢。
- **重复的 turn/assistant 条目**：`turn` 只是系统标记，不显示长篇正文；有 `assistant` 跟随时详情默认不重复展示。P1 可按 `turnId` 合并。
- **single 模式没有清单**：`turn` 模板就是“回合结束”，不能当结论；结论来自同轮的 `assistant` 消息或打开会话。
- **`issue:changed` 刷新频繁**：P0 低频可接受；P1 如出现刷新风暴，增加 `issue:progress` 事件，host 直接 patch `latestUpdate`。
- **attribution 误挂**：单 Issue 回合由 turn context 自动归属；多事件回合必须显式 `issueId`，否则不写。`ats` 只做引用，`previousIssueId` 不参与。显式 id 会校验存在/未关闭。
- **多窗口未读**：localStorage `storage` 事件同步；如果不同步，刷新后一致。
- **不把 transcript 放进详情**：detail 只存摘要/下一步/文件，完整过程仍按需打开会话。
