---
name: todo-management
description: "管理本机的 Todo/Task 任务看板：用户说「记个 todo」「新建/添加 todo」「给 todo 加任务」「创建 task」「看下任务看板/todo 列表」时使用。创建 task 必须先确认 workdir 且等用户明确说「创建 task」才落库。"
---

# Todo/Task 任务管理

你负责本机的 Todo/Task 两级任务管理（muse-work 看板功能）。操作通过 `todo.mjs` 脚本调用本地 REST API 完成。

## 实体与状态

- **todo**：大目标。含标题、描述（markdown）、优先级（p0/p1/p2，默认 p1）、来源（session/manual/popo/internal）。
- **task**：todo 下的可执行子任务。创建时**必须指定 workdir**（git 项目默认开 worktree 隔离执行、`--no-worktree` 直接在原目录执行，非 git 直接执行）；创建即入队执行，全局并发 3、FIFO 排队。

## 触发时机

- 「记个 todo：xxx」「新建 todo」「添加一个任务」→ 创建 todo
- 「给 todo X 加任务 / 拆解 / 规划」→ 引导到规划会话（todo 专属会话），在会话里细化成 task
- 「我的 todo / 看板 / 任务列表」→ 列出 todo
- 用户表示 todo 已完成（「标记完成」「这个 todo 做完了」）→ `complete <todoId>`（有任务待执行/执行中/待审核时接口拒绝，需向用户说明）

## 创建 task 流程（关键，必须遵守）

1. 确认用户要给哪个 todo 创建 task（按标题/列表确认，不猜）。
2. **向用户询问 workdir**（任务执行的工作目录）。用户给出后，复述确认。
3. 若 workdir 是 git 项目，**向用户询问是否用 worktree 隔离执行**（默认隔离：在 `<repo>/.wave/worktrees/<taskId>` 独立工作区执行，不污染主仓工作区/分支；用户明确不需要隔离时加 `--no-worktree` 直接在原目录执行）。需要 worktree 时再**询问 base 分支**（worktree 从该分支 checkout；用户未指定时用 `--branch` 缺省，即仓库默认分支）。非 git 目录无需分支。
4. **只有用户明确说「创建 task」才落库**。任何一步不确定都先问，不要擅自创建。

## 命令速查（在插件 scripts 目录下执行 `node todo.mjs ...`）

```bash
# 创建 todo（source 枚举：session/manual/popo/internal）
node todo.mjs create --title "标题" --priority p1 --source session --description "可选 markdown"

# 列出未归档 todo
node todo.mjs list

# 查看某 todo 详情与 task
node todo.mjs get <todoId>

# 给 todo 加 task（workdir 必填；git 项目默认建 worktree 隔离执行，--no-worktree 直接在原目录执行；--branch 指定 worktree 的 base 分支，可选）
node todo.mjs add-task <todoId> --title "task 标题" --workdir /path/to/dir --description "可选" --branch develop
node todo.mjs add-task <todoId> --title "task 标题" --workdir /path/to/git/repo --no-worktree

# 评论 task（审核讨论）
node todo.mjs comment <taskId> --content "评论内容"

# task 状态操作（用户明确指示才执行；确认 task 当前状态后再调用）
node todo.mjs approve <taskId>   # 审核通过 → 已完成（保留 worktree 供排查，清理执行会话；仅「待审核」可用）
node todo.mjs requeue <taskId>   # 继续执行（待审核 → 回待执行重新入队；执行中/待执行用开始执行语义也走这个）
node todo.mjs cancel <taskId>    # 取消任务（执行中会中止会话；仅执行中取消删除 worktree）

# 标记 todo 已完成（用户明确表示完成时；有任务未到终态会被拒绝）
node todo.mjs complete <todoId>
```

task 状态操作原则：**必须用户明确指示**（「通过」「继续执行」「取消这个任务」），不要主动替用户操作。不确定状态先 `get <todoId>` 查看。端口从环境变量 `MUSE_SERVER_PORT` 读取（与 webview 一致）；未设置时默认 8787。
