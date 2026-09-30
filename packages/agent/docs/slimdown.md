# @muse-work/agent 瘦身记录

Muse 走进程内 `Agent.create()`，不跑 `wave --stdio` / Wave 企业托管。fork 后分两轮砍掉 CLI 与企业侧能力，避免运行时再带上死路径。

## 保留

- 进程内 Agent、消息 / session jsonl、权限、Plan、Skill、MCP、LSP
- **本地插件**：`PluginLoader` + `PluginManager.loadPlugins([{ type: "local", path }])`
- Workflow（工具 / manager / UI；POPO 与 automation 仍禁用）
- AskUserQuestion、auto-memory、WebFetch、任务列表、subagent

## 已移除（第一轮）

- Exec 默认关闭（当时仍留源码）
- Artifact、wave-daemon、sdd、loop
- stdio / host / examples
- OpenTelemetry 实现（先改成 no-op）
- Wave remote-settings 轮询
- Cron 工具与 `CronManager`
- Enter / Exit Worktree **工具**

## 已移除（第二轮，本轮）

| 项 | 说明 |
| :--- | :--- |
| 插件市场 | `MarketplaceService`、官方 zip 镜像、`GitService`、`PluginCore`、settings 默认 `wave-plugins-official`、webview `/plugin` 市场弹窗 |
| Exec 整包 | `src/exec/*`、`execTool`、`enableExec` |
| Worktree 配套 | agent 内 `worktreeHooks` / `worktreeSession` / `worktreeUtils`（桌面 Issue 隔离目录仍在 `packages/desktop`） |
| Wave SSO | `authService`、gateway 读 `auth.json` |
| remote-settings | 服务与配置合并层 |
| Telemetry | no-op 模块与全部调用点 |
| 死名字 | Cron / Artifact / Worktree / Exec 工具常量、`types/cron|telemetry|auth|marketplace` |
| Bash `!` | `BashModeManager`、`Agent.bang`（历史 transcript 里的 bang block 仍可渲染） |
| settings skill | 去掉 CLI / stdio / 市场 / Artifact 百科，改成 Muse 本地配置说明 |

## 刻意未动

- **Workflow**：等产品评估
- 主机侧 worktree（Issue / desktop `worktree.ts`）
- Muse 设置里的 superpowers / mattpocock 开关（本地目录，不是市场）
