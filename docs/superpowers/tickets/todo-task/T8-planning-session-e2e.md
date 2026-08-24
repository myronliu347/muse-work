# T8 — 规划会话 + E2E 完整链路

- **Blocked by**: T1, T2, T4, T7
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（流程 + Seam 4）
- **原型**: 左右布局全流程

## 交付

- **规划会话**：todo 存 planningSessionId（每 todo 固定一个），**用户首次点「打开规划会话」时懒创建**；todo 详情/左栏 chat 图标打开
- **会话内 todo 管理入口**：会话里说「记个 todo」→ T7 skill 创建（可见于看板）
- **E2E 完整链路**（Seam 4，必需）：
  「会话记 todo → 打开规划会话创建 task（指定 workdir）→ 入队执行 → 待审核 + AI 复核 → 用户通过 → todo 已完成」

## 测试（Seam 4）

- 先例：`packages/webview/e2e/demo/`
- 全链路断言：todo 创建 → task 创建（含 workdir 确认）→ 执行 → 待审核（result 评论 + AI 复核 note）→ 用户通过 → task 已完成 + todo 已完成
- 注意：e2e 全量有 pre-existing 漂移失败（旧 demo 引用已删 testid），跑全量别以红判回归；本 ticket 聚焦本链路 demo
