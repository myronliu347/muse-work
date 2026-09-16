---
name: issue-management
description: "管理本机 Issue：用户明确要求创建 issue/待办时创建；清单条目与首次派发必须等用户确认后再写入/dispatch；规划+执行模式下在规划会话里维护清单并 dispatch；单 agent 工作会话可 complete/cancel 关单，不要清单和 dispatch；待审核可选子代理做 E2E/code review；用户要求完成或取消时关单。"
---

# Issue 管理

你负责在本机创建与调度 Issue（规划侧）。操作通过同目录下的 `scripts/issue.mjs` 调用本地 REST API。

**执行会话不会挂载本插件**，因此执行 AI 看不到这些命令。关单与调度只应在规划/普通/单 agent/POPO 会话完成。

系统提示词若写明「单 agent」：规划与实现都在**当前会话**，**可以改代码**；**禁止 dispatch**，**不要建清单、不要 items / exec-turn**。用户明确说关掉 / 完成 / 取消时才 `complete` 或 `cancel`。若写明「规划会话」且「不要修改产品实现」：按下面「规划与调度」执行。

## 何时创建

- **只有用户明确说要创建 issue / 待办 / 记一个任务 / 用这个建** 时才 `create`。
- 不要根据闲聊或猜测擅自建 Issue。
- **当前会话已经是某个 Issue 的会话**（system prompt 里有 Issue ID）：**禁止再 `create`**。规划+执行才对那个 ID `items --add-json`；单 agent 不要维护清单。
- **从普通对话或 POPO 创建**：`create` 只填 title / description / priority / tags，**不要**附带当前会话 workdir。workdir 仍等用户点「打开会话」再选。默认先建空 Issue，**不要**顺手 `--add-json`。
- **写入清单必须先给拟议条目，等用户确认后再写。** pending Issue 就能加条目，不必等打开会话；但「用户说建清单」只表示可以开始拟议，**同一轮不要** `items --add-json` / `create --add-json`，除非用户已经逐条确认或明确说「就这些、写进去」。
- `dispatch` 才需要已打开的**规划+执行**会话；没开规划、用户未确认开工时都不要 dispatch。

## 规划与调度

规划会话**可以**读代码做分析、写计划/分析文档（`.md` / `.txt` 等）、调用分析类子代理。**不要改产品实现**；改实现必须 `dispatch` 到执行会话，不要用 Edit/Write 或 Bash 改 `.ts`/`.vue` 等实现文件。

1. 先展示拟议清单，**用户确认条目后**再用 `get` 查看、用 `items --add-json` **追加**；未完成（pending / running）的项用 `--remove`。进行中的项 `--remove` 会中止当前执行回合，且不会再自动派回该项。**禁止整表覆盖**。**已 done 的项删不掉。** 不要在方案未确认时偷偷加项。
2. 清单已写入且**用户明确说开始执行 / 派发 / 开工**后，须已有规划会话，再按项首次 `dispatch`。未确认开工禁止 dispatch。Issue 进入**执行中**后你必须**值守**，直到清单全部 `done`。若你收到执行回报后既不 `--done` 也不再派同一项，系统会再催你；**中断/失败且你没重派同一项时，系统会替你对同一 itemId 再派一轮**（不会替你选下一项）。
3. 用户已批准开工后的每轮固定流程：`dispatch` → 执行会话干活 → 收到「来源：执行会话」短信封 → **对照清单审核产物** → 覆盖则 `--done` 再派下一项 / 没覆盖则再派同一项。用户问进度时照常回答，答完继续调度，不要问「要不要继续」。
4. 收到正文以 `来源：执行会话` 开头的系统注入时：这是**执行回合回报**，**不是**用户新需求。信里带**执行结论**，有改动时会列出文件。系统**不会**因为回合结束就把该项标为 done。
   - **审核产物**：以清单要求为准。产物不一定是文件，也可能是结论里的表格、分析、对比本身。有文件就读文件，没有文件就审执行结论是否覆盖该项。
   - **达标**：`items --done ITEM_ID`，然后再 `dispatch` 下一个 pending。未 `--done` 时系统会拒绝派下一项。
   - **未达标或只做了一半**：不要 `--done`，对**同一 itemId** 再 dispatch，`--prompt` 写清接着做什么。
   - **中断或失败**：该项仍为 pending。**禁止** `--done`、禁止派下一项；对同一 itemId 再 dispatch。
   - **需要看工具过程时**再 `exec-turn --id ISSUE_ID`（不强制）。
5. Issue 进入待审核后停止自动 dispatch，向用户汇报；可选用子代理做 E2E 或 code review（**非强制**）；有问题再 `dispatch` 返工前先征得用户同意。
6. **用户明确说关掉 / 完成 / 取消** 时立即 `complete` 或 `cancel`；**不要求**清单项全部 done，用户随时可关单。不要替用户关单。

## 命令速查

在 skill 的 `scripts/` 目录执行（Base URL：`MUSE_SERVER_URL`，或 `MUSE_HOME` 下的 `server-url` 文件，否则 `http://127.0.0.1:$MUSE_SERVER_PORT`，端口默认 8787）：

```bash
node issue.mjs create --title "标题" [--description D] [--priority p0|p1|p2] [--tags a,b] [--add-json '[{ "content": "改登录" }]']
node issue.mjs get --id ID
node issue.mjs update --id ID [--title T] [--description D] [--priority p0|p1|p2] [--tags a,b]
node issue.mjs items --id ID --add-json '[{ "content": "改登录" }]'
node issue.mjs items --id ID --done ITEM_ID
node issue.mjs items --id ID --remove ITEM_ID
node issue.mjs exec-turn --id ID
node issue.mjs dispatch --id ID --item ITEM_ID [--prompt "补充说明"]
node issue.mjs complete --id ID
node issue.mjs cancel --id ID
```

`--add-json` 只追加 pending 项，且仅在用户确认条目后使用；`--done` 把该项标为 done（不强制先读过程）；`--remove` 可删 pending 或正在执行的项（后者会中止执行回合）。需要看执行过程时用 `exec-turn`。用户未确认清单时不要 `create --add-json`。
