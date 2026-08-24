# T4 — 执行会话 + 常驻调度器 + worktree（核心）

- **Blocked by**: T1, T3
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（Server 层执行调度 + 边界场景）
- **关键前提（已探查）**：注入走 `POST /sessions/:sessionId/messages` 现成链路，agent 空闲自动重建恢复历史；worktree 创建在 desktop 主进程（worktree.ts，IPC `desktopCreateWorktree`）；POPO 有独立 Agent runtime 先例

## 交付

- **执行会话**：task 执行时创建（每 task 固定一个，复用；**不隐藏**，可进会话列表）；`permissionMode: "bypassPermissions"`（避免权限挂起）
- **worktree**：task 创建/执行时，git 项目自动建 worktree（`<repo>/.wave/worktrees/`，接通 desktop IPC 或新增 server 接口）；**非 git 项目直接在该目录执行**（不建 worktree）
- **常驻调度器**：server 启动即挂定时器扫队列；**全局并发上限 3**（所有 todo 的 task 共享槽位）；FIFO 排队（排队中仍显示「待执行」，不新增状态）；run 落盘（queued/running/finished/canceled + 时间戳）支持重启恢复；重启后 queued 自动恢复调度
- **创建即入队**：创建 task（带 workdir）→ 入队 → 槽位空立即执行 / 满则排队
- **执行结束 → 待审核**：runTurn 结束（含报错/中断）→ task 转待审核 + 写 result 评论（失败原因也以评论呈现）
- **「开始执行」**：待执行 task 手动触发入队（服务「执行中断回待执行」的重新触发）
- **执行中取消**：中止执行会话、task 已取消、run canceled、worktree 立即删

## 测试（Seam 5 调度 + Seam 2 部分）

- 先例：`sessionRunner.lifecycle.test.ts`
- 并发 3：第 4 个 task 排队不执行、排队中仍待执行
- 槽位释放后 FIFO 按序启动
- 重启恢复：queued 落盘重载后调度器自动恢复
- 执行结束 → 待审核 + result 评论（含报错/中断路径）
- worktree 创建（git）/ 直接执行（非 git）
