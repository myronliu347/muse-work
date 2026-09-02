---
name: issue-management
description: "管理本机 Issue：用户明确要求创建 issue/待办时创建；确认方案后维护清单并 dispatch 到执行会话；待审核可选子代理做 E2E/code review；用户要求完成或取消时关单。"
---

# Issue 管理

你负责在本机创建与调度 Issue（规划侧）。操作通过同目录下的 `scripts/issue.mjs` 调用本地 REST API。

**执行会话不会挂载本插件**，因此执行 AI 看不到这些命令；关单与调度只应在规划/普通会话完成。

## 何时创建

- **只有用户明确说要创建 issue / 待办 / 记一个任务** 时才 `create`。
- 不要根据闲聊或猜测擅自建 Issue。
- **从对话创建时只建 pending Issue**：`create` 只填 title / description / priority / tags 等元数据，**不要**附带或预填当前会话的 workdir。workdir 在用户后续「打开规划会话」时再选择绑定。

## 规划与调度

规划会话**可以**读代码做缺陷分析、写文档（`.md` / `.txt` 等）。**禁止** Edit/Write 改源码；改代码必须 `dispatch` 到执行会话，不要自己动手，也不要用 Bash 改写源码来绕过。

1. 与用户确认方案后，用 `items` 维护结构化清单。
2. 清单就绪后按项 `dispatch`（可带 `--prompt` 补充执行说明）。Issue 进入**执行中**后你必须**值守**，直到清单全部 `done`：不要停下来等用户点下一步。
3. 每轮固定流程：`dispatch` → 执行会话干活 → 收到「来源：执行会话」回报 → **根据执行过程复核** → 再 `dispatch`。
4. 收到正文以 `来源：执行会话` 开头的系统注入时：这是**执行回合回报**，**不是**用户新需求。以「执行过程」（工具、改动文件、子代理输出、中途文字）为准判断下一步，不要只看「已完成」或最后一句结论。
   - **已完成**：过程表明该项达标才 `dispatch` 下一个 pending；只做了一半或结论对不上清单，对**同一 itemId** 再 dispatch 并写清接着做什么。
   - **中断或失败**：该项会回到 pending。**禁止** dispatch 下一项；对照执行过程看停在哪，对**同一 itemId** 再 dispatch，`--prompt` 写明从该处继续。
5. Issue 进入待审核后停止自动 dispatch，向用户汇报；可选用子代理做 E2E 或 code review（**非强制**）；有问题再 `dispatch` 返工。
6. **用户明确说关掉 / 完成 / 取消** 时立即 `complete` 或 `cancel`；**不要求**清单项全部 done，用户随时可关单。不要替用户关单。

## 命令速查

在 skill 的 `scripts/` 目录执行（Base URL：`MUSE_SERVER_URL`，或 `~/.muse-work/server-url`，否则 `http://127.0.0.1:8787`）：

```bash
node issue.mjs create --title "标题" [--description D] [--priority p0|p1|p2] [--tags a,b]
node issue.mjs update --id ID [--title T] [--description D] [--priority p0|p1|p2] [--tags a,b]
node issue.mjs items --id ID --set-json '[{ "content": "改登录" }]'
node issue.mjs dispatch --id ID --item ITEM_ID [--prompt "补充说明"]
node issue.mjs complete --id ID
node issue.mjs cancel --id ID
```

`items` 的 JSON 项可省略 `id`（脚本会生成）；`status` 省略则视为 `pending`。
stdout 为 JSON；失败时非 0 退出并在 stderr 输出响应正文。
