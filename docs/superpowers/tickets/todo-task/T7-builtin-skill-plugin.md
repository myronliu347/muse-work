# T7 — 内置 todo/task skill 插件（会话入口，普通 + POPO）

- **Blocked by**: T1
- **Spec**: docs/superpowers/specs/2026-08-21-todo-task-design.md（AI 能力会话入口）
- **形态参考**: mattpocock 插件（plugin.json + skills + 脚本调 HTTP API）；既有先例 issue.mjs 已废弃删除、popo-cli 仍在

## 交付

- **插件目录** `packages/server/plugins/todo/`：
  - `plugin.json`（manifest：name/description/version）
  - `skills/todo-management/SKILL.md`：指导 AI 何时调用——用户说「记个 todo：xxx」→ 创建 todo；「给 todo X 规划」→ 引导打开规划会话；创建 task 流程（多轮对话确认、AI 询问 workdir、用户说「创建 task」才落库）
  - `scripts/todo.mjs`：CLI 调 REST API（create/list/get/update/comment 等，端口从 MUSE_SERVER_PORT 读，参照 webview 一致方式）
- **普通会话挂载**：sessionRunner `enabledPluginDirs()` 无条件追加 `todo`（内置能力，非 settings 开关）
- **POPO 会话挂载**：POPO agent 创建时注入 todo 插件——插件注入逻辑目前是 sessionRunner 私有闭包（`enabledPluginDirs`），需抽出共享或 POPO 侧（`createPopoAgentFactory`/`defaultCreateAgent`）拼 plugins 数组；让 POPO 机器人会话里说「记个 todo」也能创建
- **规划会话提示词**：引导用户把 todo 细化成可执行 task；workdir 在对话里确认（AI 询问）；只有用户明确说「创建 task」才落库

## 测试

- 插件挂载：普通会话 agent 与 POPO agent 的 plugins 均含 todo 插件（Seam 2 扩展）
- 脚本对 API 的调用（todo.mjs create → API 落库）
