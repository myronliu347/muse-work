# T3 — 评论/执行记录 + 抽屉交互 + 编辑

- **Blocked by**: T1, T2
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（Webview 层 + Server 层评论/编辑）
- **原型**: 详情抽屉部分

## 交付

- **评论 API**：挂 task（author: user|ai|system，kind: note|result，md content）；评论 CRUD
- **执行记录 API**：runs 的查询（runs.json 落盘，字段按 spec：queued/running/finished/canceled + 时间戳）
- **详情抽屉交互**（原型形态）：
  - 标题 + 状态徽标 + md 描述 + 执行环境（workdir/worktree）
  - 操作按钮行（图标 + tooltip）：通过/继续执行/开始执行/打开执行会话/取消 + 打开方式（在编辑器/终端打开 workdir）——本期**占位**（真实状态迁移 T4+ 接线）
  - 执行记录区 + 审核讨论区（评论流 + 输入框：textarea + 发送，md，⌘/Ctrl+Enter）
- **编辑**：抽屉「编辑」按钮（铅笔图标）→ 表单（todo：标题/描述/优先级；task：标题/描述）→ 保存调 T1 API。仅待执行显示
- 卡片/行上只保留「打开执行会话」，操作全在抽屉内（对齐原型）

## 测试（Seam 1 评论部分 + Seam 3 抽屉交互）

- 评论 CRUD：发评论、AI result 评论展示
- 抽屉：评论输入提交（⌘/Ctrl+Enter）、操作按钮按状态渲染（待执行→开始执行；待审核→通过/继续执行/取消）
- 编辑：待执行显示编辑按钮、保存后列表/卡片更新；非待执行不显示
