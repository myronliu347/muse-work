# AI 助理 — 设计说明

日期：2026-10-08  
状态：待实现  
范围：server 事件循环与助理工具；webview 侧栏入口与助理会话展示

## 问题

Issue 负责把一件事做成，自动化负责按规则跑一轮独立 Agent。两者都要等人或规则先开口，没有一个长期在线的协调者把对话、Issue 进展和自动化结果接成下一步。

## 目标与非目标

**目标**

- 一条长期活着的助理会话。应用启动时若还没有就创建，重启后续上。
- 事件循环把事件排成队列，一次一条，用 `system-inject` 注入这条会话。
- 助理自己判断：对上已有 Issue 就发消息；对不上就创建、打开会话、再发消息。
- 回复人或 POPO 必须调用 `SendMessage`。循环不把回合正文自动发出去。

**非目标**

- 助理不建清单、不 dispatch、不完成、不取消。这些由 Issue 会话自己做。
- 不改现有自动化的触发和运行模型。自动化跑完只是多一条事件。
- 不做第二个助理，不做按仓库拆分的助理。
- 不启用 worktree。

## 会话

会话身份以 session store 里 `origin` 为 `assistant` 的那一条为准。没有则创建，已有则复用，不另建索引文件，也不创建第二条。工作目录是 `<home>/assistant-chat`（与 POPO 的 `popo-chat` 一样放在应用 home 下），只作会话落点，不在这里改产品代码。权限为免确认（`bypassPermissions`），工具不弹窗。上下文满了走现有压缩。

它不出现在普通会话列表里。侧栏有一个固定入口，点进去看到的是 Muse 对话记录，不是这条会话的 transcript。

它不挂载 issue-management 技能。模型可用工具只有下面七种：`ListIssues`、`ListWorkdirs`、`CreateIssue`、`OpenIssue`、`MessageIssue`、`SendMessage`、`ListMuseMessages`。

系统提示写明判断规则：用工作目录、标题、描述决定并入还是新建；目录选不出就 `SendMessage` 回问；Issue 与自动化事件可以什么都不做。会话压缩后早期 Muse 对话不在 transcript 里，需要时用 `ListMuseMessages` 回查。

## 事件循环

循环挂在应用上下文里，与自动化运行时分开。队列持久化在 muse home 的 `db/assistant-queue.json`，FIFO。进程重启后接着跑。

一次只放行队首。助理正在跑时，新事件留在队列里。回问不堵住队列，用户的回答是之后的一条 `chat` 事件。

全部事件都以 `system-inject` 注入助理会话。正文是下面的纯文本，一行一个字段，空字段省略。

只有绑定了 Issue 的会话回合结束，以及自动化运行结束，才入队。助理自己的回合结束不入队。`MessageIssue` 让 Issue 会话跑完后，那一轮的结论以 `type: issue` 入队。执行会话结束、规划会话结束，各产生一条。

POPO 仍只接受主人。`/clear` 和 `/btw` 走原来的机器人路径。其余主人消息入队，不自动回执，也不再跑原来的 POPO 机器人会话。

### chat

有人向助理说话。

```text
type: chat
from: muse | popo | popo-group
message: ...
user: ...
groupId: ...
```

- `from: muse`：用户在助理会话里发送。先把这条写入 Muse 对话记录，再入队。不直接调用会话的 `sendMessage`。
- `from: popo`：私聊。带 `user`（邮箱或 id）。
- `from: popo-group`：群聊。带 `groupId`，以及发言人 `user`（有则带上）。

### issue

某张 Issue 的会话一轮结束。

```text
type: issue
issueId: ...
title: ...
workdir: ...
summary: ...
```

`summary` 是这一轮结论文本，按码点截断到 8000。事件在会话回合结束时产生，因此总有 `workdir`。

### automation

一次自动化运行结束，含 `skipped`。

```text
type: automation
automationId: ...
name: ...
runId: ...
workdir: ...
status: succeeded | failed | stopped | skipped
trigger: cron | once | issue | manual
error: ...
summary: ...
```

`error` 仅在有错误时出现。`summary` 同样截断到 8000；没跑起来的（`skipped`）可以没有 `summary`。

## 回复

`SendMessage`：

| 字段 | 含义 |
|------|------|
| `message` | 必填，markdown |
| `app` | `muse` 或 `popo` |
| `user` | 发给某人时的邮箱或 id |
| `groupId` | 发 POPO 群时的群 id |

- `app: muse`：成功后把这条 markdown 追加进 Muse 对话记录。失败不写。
- `app: popo`：走现有机器人 `sendText`。有 `groupId` 则发给该群，否则发给 `user`。不写入 Muse 对话记录。
- `user` 和 `groupId` 都空，或 POPO 未配置：工具返回错误，不猜接收人。

## Muse 对话记录

Muse 界面只展示这份记录，不渲染助理会话的 transcript。模型仍读 transcript（系统注入和工具调用在那里）；transcript 压缩后，用 `ListMuseMessages` 回查这里。

目录是 muse home 下的 `db/assistant-messages/`。文件按序号命名：`000001.jsonl`、`000002.jsonl`。只往编号最大的一片末尾追加。追加前若该片已达到 1 MiB（1048576 字节），先换下一片。一条消息是一整行，不拆到两个文件。若这一行本身使该片超过 1 MiB，它留在当前片，下一条再开新片。

每行：

```json
{"id":"...","at":1710000000000,"role":"user","message":"..."}
{"id":"...","at":1710000001000,"role":"assistant","message":"..."}
```

`id` 为 uuid。`at` 为毫秒时间戳。`role: user` 是用户在 Muse 里发出的消息。`role: assistant` 是 `SendMessage` 且 `app: muse` 成功后的正文。`message` 为完整 markdown，存储时不截断。POPO 来回不进入这些文件。

界面第一次打开只取最新一片末尾 50 行。滚到顶再向更早的行要，当前片不够就打开上一片。新行追加后，停在底部的界面只接这一行。接口为 `GET /assistant/messages?before=<id>&limit=50`，按时间从早到晚返回这一页，并带 `hasMore`。新行用 websocket 事件 `assistant:chat` 推给已打开的界面。现有的 `assistant:message` 是会话流里「助理消息开始」的事件，不能复用。

`ListMuseMessages` 读同一目录，从最新一片往前：

- 无参数：最新 50 条，时间从早到晚。
- `before`：消息 `id`，返回比它更早的一页，最多 50 条。
- `q`：对 `message` 做子串匹配，从新到旧。最多扫描 8 个文件或 8 MiB，先到为止。未扫完时 `truncatedScan: true`。
- 返回的单条 `message` 超过 8000 个码点则截断，并带 `truncated: true`。磁盘上的原文不截断。

返回 `{ messages: [{ id, at, role, message, truncated? }], hasMore, truncatedScan? }`。`hasMore` 表示这一页之前还有更早的记录。`limit` 默认 50，最大 50。

## 协调

`ListIssues` 返回未完成 Issue：`id`、`title`、`description`、`workdir`（尚未打开会话时可空）、会话是否已打开。

`ListWorkdirs` 返回去重后仍存在于磁盘的目录。来源是全部带工作目录的 Issue、全部自动化规则，以及全部 `origin` 为 `user` 的会话。

`CreateIssue` 要标题和描述。未传优先级时为 `p1`，标签默认空。

`OpenIssue` 给尚未打开会话的 Issue 打开会话。参数是 `issueId`、`workdir`、`agentMode`（`single` 或 `split`）。未传模式时为 `single`。不启用 worktree。目录不存在则返回错误。已经打开过的返回现有 `sessionId` 和 `workdir`，不另开一条。

`MessageIssue` 往该 Issue 打开时创建的那条会话（单 agent 的工作会话，或规划+执行里的规划会话）发送一条用户消息。会话正在跑时，沿用现有会话队列，排到下一轮。会话还没打开则返回错误。

助理在一轮里的判断：

1. 需要回人时调用 `SendMessage`。
2. 需要协调时先 `ListIssues`。同一工作目录下标题和描述对得上，就 `MessageIssue`。还没打开会话的，可以用标题和描述认定是同一件，然后 `OpenIssue` 再 `MessageIssue`。
3. 对不上则 `CreateIssue`、`OpenIssue`、`MessageIssue`。打开时的模式由助理选择，拿不准用 `single`。
4. 目录选不出则 `SendMessage` 回问，本轮结束。
5. `issue` 与 `automation` 事件可以不调用任何工具。

## 失败

队首事件导致助理回合失败：该事件留在队首，正文追加 `retry: 1` 和 `error: ...`，再注入一次。第二次仍失败：从队列删除，由循环直接在助理会话 transcript 写入一条失败记录（不经过模型，也不再入队，不写入 Muse 对话记录），内容含事件类型和错误，然后处理下一条。Muse 界面不显示这条失败记录。

工具错误留在当前回合，交回模型。目录不存在、`MessageIssue` 时会话未打开、`SendMessage` 缺接收人、POPO 未配置，都是这种错误。

## 测试

服务端单测，不启动真实模型。

- 三种事件按 FIFO 注入同一条助理会话；回合未结束时后续事件等待。
- 队列落在 `db/assistant-queue.json`，重启后续跑。
- 回合失败再注入一次并带 `retry` 与 `error`；第二次失败后队列去掉该条，失败记录只在 transcript 里，不在 `db/assistant-messages/`。
- 助理自身回合不入队。`MessageIssue` 对应的 Issue 会话结束后入队一条 `type: issue`。
- 三种正文字段与上文一致；`summary` 超过 8000 码点时被截断。
- `SendMessage`：`muse` 成功后向 `db/assistant-messages/` 追加一行 `role: assistant`，失败不写；`popo` 有 `groupId` 发群，否则发 `user`，且不写 Muse 记录；两者皆空或 POPO 未配置时工具失败。
- Muse 用户发送先追加 `role: user`，再入队 `from: muse`。记录按 1 MiB 换片；单行可超过 1 MiB 并独占当前片。`GET /assistant/messages` 默认返回最新 50 行，`before` 跨片向更早读取。
- `ListMuseMessages` 与上述读取同一目录。默认 50 条；`before` 翻更早的一页；`q` 最多扫 8 片或 8 MiB，未完则 `truncatedScan`；返回正文超过 8000 码点则 `truncated`，磁盘原文仍完整。
- `CreateIssue` 默认 `p1`、空标签。`OpenIssue` 默认 `single`、无 worktree；已打开返回原会话；目录不存在失败。`MessageIssue` 在目标会话运行中时被该会话队列接受。
- 助理工具列表为上述七种，不含清单、dispatch、完成、取消。
- POPO `/clear` 与 `/btw` 不入队；其他主人消息入队且不自动回执；非主人仍被拒绝。
