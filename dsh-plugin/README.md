# Muse 工作台

把 Muse 的「事项 + 派活」搬进 DeepSeek Harness。宿主侧用一个 `ctx.muse` 服务存事项、绑会话、开 `/muse` 路由；模型侧是 `muse-lead` 预设里的四个工具；界面侧是侧栏一个入口和一张事项页。

## 装了什么

- **Host 插件** `@muse-work/dsh-muse`：事项 JSON 存储（`$DSH_HOME/muse/issues.json`）、事项 ↔ 会话绑定、`/muse/*` HTTP 路由、`turn/end` 事件把事项推进到待审核。
- **工具**（只在 `muse-lead` 预设里）：`CreateIssue`、`ListIssues`、`GetIssue`、`MessageIssue`、`CloseIssue`。
- **预设**：
  - `muse-lead`：总管，带事项工具，不改代码。
  - `muse-exec`：执行，改代码、跑验证，不带事项工具。
- **界面**：侧栏 `Muse` 入口 + 事项页。新建、查看、派活、标记完成。

## 怎么用

1. 装好后新建一个会话，预设选 **Muse**。
2. 说一件事，例如「帮我看下登录接口为什么 500」。
3. agent 会 `CreateIssue` 再 `MessageIssue`，自动开一条 `muse-exec` 会话干活。
4. 侧栏 `Muse` 里能看到事项和它绑定的会话；执行会话在左侧会话列表里。

## 边界

- 现在只有事项的第一层状态：待开始 / 进行中 / 待审核 / 已完成 / 取消。规划+执行、worktree、助手事件队列、自动化都还没进。
- 事项数据在 `$DSH_HOME/muse/issues.json`，不进会话日志。
- 助手还不是常驻协调器：没有事件队列，也没有「事项结束自动唤醒助手」。
- 所有 `/muse` 路由只监听本机，没有额外鉴权。

设计背景见 `docs/superpowers/specs/2026-11-19-dsh-muse-plugin-design.md`。
