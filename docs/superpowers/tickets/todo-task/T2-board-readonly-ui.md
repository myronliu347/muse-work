# T2 — 任务看板只读 UI（左右布局）

- **Blocked by**: T1
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（Webview 层 + 原型）
- **原型**: docs/superpowers/prototypes/2026-08-21-todo-task-board-prototype.html（定稿 A，直接参照）

## 交付

- MainView 枚举扩展 `todo-board`；侧边栏新增入口（app-menus，codicon-tasklist）；Webview 层切到该视图渲染看板（参照 popo-robot 视图的接入方式）
- **左栏 todo 列表**：顶部「+ 新建 TODO」入口（弹输入框：标题/描述/优先级，调 T1 API 创建）；按优先级排序（p0→p1→p2）；每行 = 优先级徽标 + 标题 + 状态徽标 + 来源；todo 行内右侧图标（chat 打开规划会话、✕ 取消——交互接线后续 ticket，本期占位）
- **右栏任务看板**：选中 todo 的 task 按状态分 4 列（待执行/执行中/待审核/已完成）；卡片 = 标题 + 描述摘要 + worktree + 底部「打开执行会话」图标；点击卡片 → 右侧详情抽屉（骨架）
- **待执行 todo（无 task）**：右栏不显示看板列，居中引导「打开规划会话」
- **归档过滤**：已完成/已取消的 todo 不显示（数据保留）
- task 描述按 markdown 渲染（复用现有 md 渲染管线）
- 描述 md 渲染、卡片布局全部对齐原型

## 测试（Seam 3）

- 先例：`packages/webview/tests/components/`、`apiClient.test.ts`
- todo 列表按优先级排序渲染、归档 todo 不出现
- 选中 todo 切换右栏看板；无 task 时显示空态引导
- 看板 4 列渲染、task 卡片内容（标题/md 摘要/worktree）
- 新建 todo 弹窗提交调用 API
