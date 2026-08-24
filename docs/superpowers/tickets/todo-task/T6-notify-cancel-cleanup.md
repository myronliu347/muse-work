# T6 — 通知组件 + badge + 取消/归档/清理

- **Blocked by**: T4, T5
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（通知 + 状态机 + 边界场景）
- **原型**: 右上角通知组件 + 左栏入口 badge（对齐定稿）

## 交付

- **通知**：只通知「task 进待审核」一个事件。① 应用内右上角通知组件（复用/扩展 ToastStack 通道）：图标 + 标题「Muse · 任务待审核」+ 正文 `todo 标题 · task 标题 待审核` + meta（时间/优先级/AI 复核状态）+ 关闭按钮；滑入动画、8s 自动消失、多条堆叠、点击跳转对应 task 详情抽屉；② 看板入口 badge（未审核 task 计数）
- **取消语义**：task 除已完成外任意状态可取消（取消不影响 todo 完成）；todo 取消 → 级联取消其所有未完成 task；执行中取消中止执行会话
- **归档显示**：已完成/已取消的 todo 不显示在主视图；task 已取消不显示、已完成保留在列内（T2 已做过滤，本期补取消后列表刷新）
- **成功后自动清理**：task 审核通过（已完成）→ 自动删 worktree + 执行会话（复用 desktop 删除会话链路）；执行中断/取消/继续执行时 worktree 保留；非 git 无 worktree 可删、仅清执行会话

## 测试

- 通知：task 进待审核触发通知 + badge 计数更新、点击跳转（Seam 3 渲染）
- 取消：task 取消不影响 todo 完成；todo 级联取消（Seam 1）
- 清理：通过后 worktree/执行会话删除、取消/继续执行保留（Seam 5 扩展）
