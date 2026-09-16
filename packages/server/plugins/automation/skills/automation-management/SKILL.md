---
name: automation-management
description: "管理本机自动化规则：用户明确要求定时/例行/到点跑 Agent、或 Issue 创建/审核/完成时自动跑时创建；可列出、改、立即运行、停用、启用；只有用户明确说删除才 delete。「暂停」= disable，不是删除。"
---

# 自动化管理

你负责在本机创建与管理自动化规则。操作通过同目录下的 `scripts/automation.mjs` 调用本地 REST API。

**执行会话（issue-exec）和自动化运行会话不会挂载本插件**，因此无人值守运行看不到这些命令。只在普通 / 规划 / POPO 会话里创建和管理规则。

## 何时创建

- **只有用户明确说要创建自动化 / 定时任务 / 每天几点跑 / Issue 发生时自动跑** 时才 `create`。
- 不要根据闲聊或猜测擅自建规则。
- **workdir 必须用当前会话的工作目录**（system prompt 或会话元数据里的路径），由你传入 `--workdir`，不要问用户「工作目录填哪」。用户另外指定了目录则用用户的。
- 「暂停 / 停用 / 先别跑」= `disable`，**不是** `delete`。规则和历史运行都保留。
- 「重新启用 / 再开」= `enable`。停用期间错过的拍不会补跑。
- **禁止未明确时删除。** 只有用户清楚说「删掉这条规则」才 `delete`。

## 触发器

- 定时：`--cron` 可重复，传 5 字段 cron（本地时区）。用户说「每天九点」就编译成 `0 9 * * *`，不要把 cron 字符串念给用户听，除非他们要看。
- Issue：`--issue-events created,review`（可选 `completed`、`cancelled`）。
- 一条规则可同时有多个 cron 和一组 Issue 事件。

创建完整规则（name + prompt + workdir + 至少一个触发器）后会直接启用。缺触发器则留下草稿，不要擅自 enable。

## 命令速查

在 skill 的 `scripts/` 目录执行（Base URL：`MUSE_SERVER_URL`，或 `MUSE_HOME` 下的 `server-url` 文件，否则 `http://127.0.0.1:$MUSE_SERVER_PORT`，端口默认 8787）：

```bash
node automation.mjs create --name "名称" --prompt "指令" --workdir /abs/path [--cron "0 9 * * *"] [--cron "0 18 * * *"] [--issue-events created,review] [--description D] [--model M] [--agent A]
node automation.mjs list
node automation.mjs get --id ID
node automation.mjs update --id ID [--name N] [--prompt P] [--workdir W] [--description D] [--model M] [--agent A] [--cron EXPR] [--issue-events E]
node automation.mjs enable --id ID
node automation.mjs disable --id ID
node automation.mjs run --id ID
node automation.mjs runs --id ID
node automation.mjs delete --id ID
```

`run` 是立即跑一轮（调试 prompt）；规则必须已启用。`disable` 之后 cron / Issue / 立即运行都不会再 enqueue。
