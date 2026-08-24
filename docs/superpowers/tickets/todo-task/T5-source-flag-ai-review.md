# T5 — 来源标记 + AI 复核回环

- **Blocked by**: T4
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（Server 层注入链路 + AI 复核）
- **关键前提（已探查）**：注入入口现成（POST /messages + agent 自动重建）；**需新建** sendMessage 来源标记——现有 sendMessage 无 type/meta 字段，注入消息在 webview 会显示成普通用户气泡

## 交付

- **sendMessage 来源标记**（server 三处 + webview 渲染）：
  - sendMessage 增加来源字段（区分「用户本人」vs「系统注入」）
  - 广播与消息落盘带上该标记
  - webview 渲染：系统注入消息用独立样式（区别于用户气泡）
- **AI 复核回环**：task 进待审核 → 自动向 todo 的规划会话注入进度消息（带系统标记）→ AI 做一轮 review → 结论写 note 评论到 task 详情；**仅作参考，不改变 task 状态**
- 注入不打断用户当前回合（SDK 串行队列自动排队，已验证）
- **注入失败处理**：重试一次，仍失败跳过——task 不阻塞在待审核，评论标注「AI 复核失败」

## 测试（Seam 2）

- 先例：`sessionRunner.lifecycle.test.ts`
- task 进待审核 → 注入消息带来源标记
- agent 空闲销毁后注入仍触发（自动重建）
- 复核结论 note 评论落盘
- 注入失败重试一次后跳过、task 仍待审核
