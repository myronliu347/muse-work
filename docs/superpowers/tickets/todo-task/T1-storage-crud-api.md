# T1 — Todo/Task 存储与基础 CRUD API

- **Blocked by**: 无
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md
- **词汇**: CONTEXT.md（todo/task/来源/绑定 workdir）

## 交付

- `~/.muse-work/db/` 分文件存储（沿用 sessionStore 模式：内存 Map + JSON 原子写，**不用 SQLite**）：
  - `todos.json` — todo 索引（轻量，单文件）
  - `todos/<todoId>/tasks.json`、`comments.json`、`runs.json` — 每 todo 独立目录，评论/执行记录只重写小文件
- Todo 实体：`id/title/description( md)/priority(p0|p1|p2 默认 p1)/source(会话|手动创建|POPO 任务|内部管理平台)/status/planningSessionId?/createdAt/updatedAt`
- Task 实体：`id/todoId/title/description(md)/status/workdir/worktreeName?/executionSessionId?/createdAt/updatedAt`
- REST 路由组（Hono，参照 routes/sessions.ts）：
  - todo：create/list/get/update/delete（delete = 取消，级联后续 T6 细化）
  - task：create（**workdir 必填**）/list/get/update/delete
- 状态迁移（基础部分）：创建第一个 task → todo 自动「进行中」
- **手动编辑**：仅「待执行」可编辑——todo 可改标题/描述/优先级（来源不可改）；task 可改标题/描述（workdir 不可改）

## 测试（Seam 1）

- 先例：`tests/popoRoutes.test.ts`、`tests/sessions.control.routes.test.ts`（Hono app + 内存 store 直测）
- todo 创建（默认 p1、来源标记、md 描述落库）
- 创建第一个 task → todo 转「进行中」
- 待执行可编辑 / 执行中锁定 / 字段不可改（来源、workdir）
- 持久化：store 写盘后重载恢复（先例：sessionStore.persist.test.ts）
