---
name: automation-management
description: "用户要创建、查看、修改、启用、停用、立即跑或删除本机自动化规则时使用。用户说「自动化」、每天/定时/到点自动开一轮独立 Agent、到点只提醒助手，或 Issue 创建/审核/完成时自动跑，也用本 skill。当前对话里一次性干活、Workflow 后台编排、系统 crontab、sleep 轮询不要用。"
---

# 自动化管理

你负责在本机创建与管理自动化规则。操作通过同目录下的 `scripts/automation.mjs` 调用本地 REST API。

**执行会话（issue-exec）和自动化运行会话不会挂载本插件**，因此无人值守运行看不到这些命令。只在普通 / 规划会话里创建和管理规则。

## 何时不要用

- 用户只是让你**在当前对话里做完这件事**：直接干，不要建规则。
- 不要用 SDK `Workflow`、Bash 后台、系统 crontab 或 sleep 循环代替本机自动化规则。

## 何时创建

- **只有用户明确说要创建自动化 / 定时任务 / 每天几点跑 / Issue 发生时自动跑** 时才 `create`。
- 不要根据闲聊或猜测擅自建规则。
- **只添加用户点名的触发器**：用户只说 Issue 审核时跑，就只传 `--issue-events`，不要擅自加 `--cron`；用户只说定时，就只传 `--cron`，不要擅自加 Issue 事件。
- **不要替用户编造 cron**：用户没提定时/周期/到点，就不要 `--cron`。用户说「每天九点」等自然语言时，你再编译成 `0 9 * * *`，不要把 cron 字符串念给用户听，除非他们要看。
- **workdir 必须用当前会话的工作目录**（system prompt 或会话元数据里的路径），由你传入 `--workdir`，不要问用户「工作目录填哪」。用户另外指定了目录则用用户的。助理会话除外：它的工作目录只是落点，不是项目。助理来建规则时用用户指定的目录，没指定先问，不要用助理自己的目录。
- 「暂停 / 停用 / 先别跑」= `disable`，**不是** `delete`。规则和历史运行都保留。
- 「重新启用 / 再开」= `enable`。停用期间错过的拍不会补跑。
- **禁止未明确时删除。** 只有用户清楚说「删掉这条规则」才 `delete`。

## 禁止

- **不要用 issue 插件去 `dispatch`、改 Issue 状态或关单。** 本 skill 只管自动化规则本身。

## 触发器

- 定时：`--cron` 可重复，传 5 字段 cron（本地时区）。
- Issue：`--issue-events created,review`（可选 `completed`、`cancelled`）。可选 `--priority p0|p1|p2`（与 REST 相同；省略则不过滤）。Issue 没有标签，不要再传 `--tags`。
- 一条规则可同时有多个 cron 和一组 Issue 事件（priority 只作用在该 issue 触发器上）。

创建完整规则后会直接启用。跑 Agent 的规则要 name + prompt + workdir + 至少一个触发器。只提醒助手的规则加 `--remind`，要 name + `--hint` + 至少一个触发器，不要写 prompt。缺触发器则留下草稿，不要擅自 enable。

`--hint` 写助手收到这次结果后要做的事（例如把结论发回提问的频道）。跑 Agent 的规则也要带上，否则助手只看到报告、不知道接下来做什么。

## 更新触发器（整表替换）

`update` 时，**只要传了任意 `--cron` 或 `--issue-events`，就会整表替换 `triggers`**，不会与旧触发器合并。你要保留的 cron 和 Issue 事件必须在这一条命令里全部带上；只传 `--cron` 会清掉原来的 Issue 触发器，只传 `--issue-events` 会清掉原来的 cron。

## 命令速查

在 skill 的 `scripts/` 目录执行（Base URL：`MUSE_SERVER_URL`，或 `MUSE_HOME` 下的 `server-url` 文件，否则 `http://127.0.0.1:$MUSE_SERVER_PORT`，端口默认 8787）：

```bash
node automation.mjs create --name "名称" --prompt "指令" --workdir /abs/path --hint "收到后把结论发回提问的频道" [--cron "0 9 * * *"] [--cron "0 18 * * *"] [--issue-events created,review] [--priority p0] [--description D] [--model M] [--agent A]
node automation.mjs create --remind --name "站会" --hint "提醒用户该开站会了" --cron "30 9 * * 1-5"
node automation.mjs list
node automation.mjs get --id ID
node automation.mjs update --id ID [--name N] [--prompt P] [--workdir W] [--hint H] [--remind] [--description D] [--model M] [--agent A] [--cron EXPR] [--issue-events E] [--priority p0|p1|p2]
node automation.mjs enable --id ID
node automation.mjs disable --id ID
node automation.mjs run --id ID
node automation.mjs runs --id ID
node automation.mjs delete --id ID
```

`run` 是立即跑一轮（调试 prompt）；规则必须已启用。`disable` 之后 cron / Issue / 立即运行都不会再 enqueue。
