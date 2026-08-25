---
name: todo-management
description: "管理本机的 Todo/Task 任务看板：用户说「记个 todo」「新建/添加 todo」「给 todo 加任务」「创建 task」「看下任务看板/todo 列表」时使用。创建 task 必须先确认 workdir 且等用户明确说「创建 task」才落库。"
---

# Todo/Task 任务管理

你负责本机的 Todo/Task 两级任务管理（muse-work 看板功能）。操作通过 `todo.mjs` 脚本调用本地 REST API 完成。

## 实体与状态

- **todo**：大目标。含标题、描述（markdown）、优先级（p0/p1/p2，默认 p1）、来源（session/manual/popo/internal）、可选绑定工作目录（workdir）。绑定后规划会话开在该目录，其下新 task 未指定 workdir 时自动继承；未绑定则规划会话用默认目录（`~/.muse-work/personal`），task 的 workdir 由用户指定。
- **task**：todo 下的可执行子任务。创建时**必须确定 workdir**（todo 绑定了目录时可直接继承不用再问；否则询问用户。git 项目默认开 worktree 隔离执行、`--no-worktree` 直接在原目录执行，非 git 直接执行）；创建即入队执行，全局并发 3、FIFO 排队。

## 触发时机

- 「记个 todo：xxx」「新建 todo」「添加一个任务」→ 创建 todo
- 「给 todo X 加任务 / 拆解 / 规划」→ 引导到规划会话（todo 专属会话），在会话里细化成 task
- 「我的 todo / 看板 / 任务列表」→ 列出 todo
- 用户表示 todo 已完成（「标记完成」「这个 todo 做完了」）→ `complete <todoId>`（有任务待执行/执行中/待审核时接口拒绝，需向用户说明）

## 创建 task 流程（关键，必须遵守）

1. 确认用户要给哪个 todo 创建 task（按标题/列表确认，不猜）。
2. **确定 workdir**：todo 已绑定工作目录 → 直接用 todo 的绑定目录，无需再问（add-task 可不传 `--workdir`）；未绑定 → **向用户询问 workdir**（任务执行的工作目录）。用户给出后，复述确认。
3. 若 workdir 是 git 项目，**向用户询问是否用 worktree 隔离执行**（默认隔离：在 `<repo>/.wave/worktrees/<taskId>` 独立工作区执行，不污染主仓工作区/分支；用户明确不需要隔离时加 `--no-worktree` 直接在原目录执行）。需要 worktree 时再**询问 base 分支**（worktree 从该分支 checkout；用户未指定时用 `--branch` 缺省，即仓库默认分支）。非 git 目录无需分支。
4. **只有用户明确说「创建 task」才落库**。任何一步不确定都先问，不要擅自创建。

## 拆解 task 原则（重要）

拆解（规划会话把 todo 细化成 task 时）必须遵守，防止执行出错：

1. **依赖合并**：实现→验证/测试等有依赖的工作必须合并进 1 个 task，由执行 agent 完成后自行验证；只有互不依赖的独立需求才拆多个；并行 task 改同一批文件或有先后依赖一律合并。
2. **描述写全**：task 描述必须含背景、方案要点、约束、验收标准（执行 agent 是全新会话，只有描述可依赖）。
3. **工具区分**：看板 task 只能 `todo.mjs add-task` 落库；系统 TaskCreate/TaskUpdate/TaskList 是会话内清单，勿用于看板。
4. **规划会话只读**：可读代码分析，禁止 Edit/Write 修改仓库文件，改动拆 task 交执行会话。

## 命令速查（脚本在本 skill 目录的 scripts/ 下，执行 `node scripts/todo.mjs ...`）

```bash
# 创建 todo（source 枚举：session/manual/popo/internal；--workdir 可选：绑定工作目录，task 缺省继承）
node scripts/todo.mjs create --title "标题" --priority p1 --source session --description "可选 markdown" --workdir /path/to/dir

# 列出未归档 todo（--archived 查看已完成 todo 归档）
node scripts/todo.mjs list
node scripts/todo.mjs list --archived

# 查看某 todo 详情与 task
node scripts/todo.mjs get <todoId>

# 给 todo 加 task（--workdir 可选：缺省继承 todo 绑定目录，todo 也未绑定时需显式传入；git 项目默认建 worktree 隔离执行，--no-worktree 直接在原目录执行；--branch 指定 worktree 的 base 分支，可选）
node scripts/todo.mjs add-task <todoId> --title "task 标题" --workdir /path/to/dir --description "可选" --branch develop
node scripts/todo.mjs add-task <todoId> --title "task 标题" --workdir /path/to/git/repo --no-worktree

# 评论 task（审核讨论；--author 默认 user，--kind 默认 note；AI 执行结果用 --author ai --kind result）
node scripts/todo.mjs comment <taskId> --content "评论内容"
node scripts/todo.mjs comment <taskId> --content "任务结果摘要" --author ai --kind result
node scripts/todo.mjs comment <taskId> --content "系统提示" --author system --kind note

# 查看 task 的评论 / 执行记录
node scripts/todo.mjs comments <taskId>
node scripts/todo.mjs runs <taskId>

# 编辑 todo（仅 pending 可改，其他状态 409；--workdir 改的是后续 task 的继承值=规划会话目录，task 创建时未指定 workdir 才用）
node scripts/todo.mjs update <todoId> --title "新标题" --description "新描述" --priority p0 --tags 标签1,标签2 --workdir /path/to/dir

# 编辑 task（仅 pending 可改 title/description；task 的 workdir 不支持修改）
node scripts/todo.mjs update-task <taskId> --title "新标题" --description "新描述"

# task 状态操作（用户明确指示才执行；确认 task 当前状态后再调用）
node scripts/todo.mjs approve <taskId>   # 审核通过 → 已完成（保留 worktree 供排查，清理执行会话；仅「待审核」可用）
node scripts/todo.mjs requeue <taskId>   # 继续执行（待审核 → 回待执行重新入队；执行中/待执行用开始执行语义也走这个）
node scripts/todo.mjs cancel <taskId>    # 取消任务（执行中会中止会话；仅执行中取消删除 worktree）

# 标记 todo 已完成（用户明确表示完成时；有任务未到终态会被拒绝）
node scripts/todo.mjs complete <todoId>
```

## 编辑限制

- **todo**：仅 `pending`（待执行）可编辑（`update`）；进行中/已完成/已取消的 todo 改任何字段都会 409。
- **todo.workdir**：`update --workdir` 修改的是**后续 task 的继承值**（新 task 创建时未指定 workdir 就继承它，规划会话也开在这里）；已存在 task 的 workdir 不受影响。
- **task**：仅 `pending` 可编辑 `title`/`description`（`update-task`）；task 的 workdir 不支持修改（执行中由 worktree 接管，归档后不可改）。

task 状态操作原则：**必须用户明确指示**（「通过」「继续执行」「取消这个任务」），不要主动替用户操作。不确定状态先 `get <todoId>` 查看。端口从环境变量 `MUSE_SERVER_PORT` 读取（与 webview 一致）；未设置时默认 8787。
