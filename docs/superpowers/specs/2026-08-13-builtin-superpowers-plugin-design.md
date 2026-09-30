# 内置 Superpowers 插件

**日期**：2026-08-13  
**状态**：待评审  
**来源**：对话确认（全局开关、方案 A：server 内置 Wave 本地插件）

## 1. 目标

Muse server 内置 [obra/superpowers](https://github.com/obra/superpowers) 插件，使 Agent 的 Skill 工具能调用其 skill（brainstorming、TDD、debugging 等）。插件**默认开启**，可在设置「插件」页关闭；开关为**用户全局**（`~/.muse-work/`），对所有工作目录生效。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| 加载方式 | `AgentOptions.plugins: [{ type: "local", path }]`，不改 SDK `builtin/plugins` |
| 开关范围 | 用户全局，所有项目共用 |
| 默认 | 开启（缺文件 / 缺字段视为 `true`） |
| 设置入口 | ConfigDialog 新增「插件」tab；切换立即 PATCH，不走「保存」 |
| 设置存储 | `~/.muse-work/settings.json`，由 server 读写 |
| Superpowers 内容 | vendor `skills/` + LICENSE 进仓库（固定 6.3.0），不是 git submodule，构建时不联网 |
| SessionStart | Wave 格式 Node hook，注入 `using-superpowers` 全文（对齐 SDD） |
| 斜杠菜单 | 本轮不做；skill 对模型经 Skill 工具可用即可 |

## 3. 范围

**做**

- Vendor Superpowers 6.3.0 的 `skills/` 与 `LICENSE` 到 `packages/server/plugins/superpowers/`，加上 Wave 清单与 SessionStart hook。
- `museSettings` 读写全局设置；`GET/PATCH /settings`。
- `sessionRunner`：开启时传入本地插件；身份指纹包含开关；PATCH 后 `invalidateAgentIdentities()`。
- 设置 Dialog「插件」tab：Superpowers 开关，默认开。
- `prepareServer` / server `package.json` 保证 `plugins/` 进入打包产物。

**不做**

- 插件市场、安装/卸载、按项目覆盖。
- SDK 自带 SDD（`sdd@builtin`）开关；保持 SDK 默认关。
- 把 skill 列进 `/` 斜杠命令弹层。
- 自动跟踪上游 Superpowers 更新。

## 4. 插件目录

```text
packages/server/plugins/superpowers/
  .muse-plugin/plugin.json
  LICENSE                          # Superpowers MIT
  skills/<name>/SKILL.md           # 从 obra/superpowers@6.3.0 原样拷贝
  hooks/hooks.json
  scripts/session-start.js
```

`plugin.json`：

```json
{
  "name": "superpowers",
  "description": "Core skills library: TDD, debugging, collaboration patterns, and proven techniques",
  "version": "6.3.0",
  "author": { "name": "Jesse Vincent" }
}
```

`hooks/hooks.json`（与 SDD 相同形态）：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${MUSE_PLUGIN_ROOT}/scripts/session-start.js\""
          }
        ]
      }
    ]
  }
}
```

`session-start.js` 读取 `skills/using-superpowers/SKILL.md`，向 stdout 打印：

```json
{ "hookSpecificOutput": { "additionalContext": "<EXTREMELY_IMPORTANT>…using-superpowers 全文…</EXTREMELY_IMPORTANT>" } }
```

读文件失败时打印空 `additionalContext` 并退出 0，不阻断会话。

**运行时路径**：在 `packages/server/src/` 顶层模块（编译后为 `dist/*.js`）用 `import.meta.url` 解析 `../plugins/superpowers`。目录不存在 → 打 error 日志，当关闭处理，会话仍创建。

**打包**：`packages/server/package.json` 的 `files` 包含 `dist` 与 `plugins`。`prepareServer.mjs` 的 `pnpm deploy` 会带上该目录；若 deploy 漏掉，在 `prepareServer.mjs` 里显式 `cpSync`。

## 5. 设置

路径：`~/.muse-work/settings.json`（`getMuseHomeDir(home)/settings.json`）。

```json
{ "version": 1, "plugins": { "superpowers": true } }
```

- 缺文件、缺 `plugins.superpowers`、文件损坏：视为 `true`，损坏时 warn，不抛给 UI。
- 显式 `false` 才关闭。
- 写盘：`mkdir` `0o700`，文件 `0o600`，JSON + 换行（与 `ui.json` / providers 一致）。
- PATCH 按键合并：只改传入的 plugin id，不丢其他字段。

### HTTP

`GET /settings` → 已套默认后的对象：

```json
{ "version": 1, "plugins": { "superpowers": true } }
```

`PATCH /settings` body：`{ "plugins": { "superpowers": boolean } }`。

- 缺少 `plugins.superpowers` 或不是 boolean → 400。
- 成功 → 写盘，`runner.invalidateAgentIdentities()`，返回与 GET 相同形状。

## 6. Agent 加载

`createAgentWithRestore` 在 `Agent.create` 选项中：

- `superpowers === true` 且插件目录存在 → `plugins: [{ type: "local", path: absDir }]`
- 否则不传 `plugins`（SDK 仍可加载用户自己的 marketplace 插件；不启用 `sdd@builtin`）

身份指纹在现有 `gatewayIdentity` 上追加 `superpowers:on` 或 `superpowers:off`。开关变化后，即使 gateway 不变也会在下次 `ensureAgent` 时 dispose 旧实例并重建。进行中的一轮不打断。

## 7. UI

ConfigDialog tab 顺序：外观 → **插件** → 供应商。

「插件」页一个开关：

- 标题：Superpowers
- 说明：内置技能库（TDD、调试、协作流程）。关闭后新的对话轮次不再加载这些 skill。
- `data-testid="superpowers-toggle"`
- 打开 Dialog 时 GET `/settings`；切换立即 PATCH。失败时开关回滚并显示错误。
- 不计入供应商表单 dirty；关 Dialog 不因该开关弹出「未保存」。

## 8. 数据流

```text
ConfigDialog「插件」
  GET  /settings  →  显示开关
  PATCH /settings →  museSettings 写盘
                  →  runner.invalidateAgentIdentities()

ensureAgent
  load settings + resolve plugin dir
  Agent.create({ ..., plugins?: [{ type: "local", path }] })
  SDK PluginManager 注册 skills + SessionStart
```

## 9. 测试

**server**

- `museSettings`：缺文件默认开；`false` 关掉；损坏 JSON 回退默认。
- `GET/PATCH /settings`：往返；非法 body 400；PATCH 后 `invalidateAgentIdentities` 被调用。
- `sessionRunner`：开且目录存在 → `createAgent` 收到 `plugins[0].path` 指向内置目录；关 → 选项无 `plugins`。

**webview**

- ConfigDialog 有「插件」tab。
- Superpowers 开关默认 checked（GET 返回 true）。
- 点击后发出 `PATCH /settings`，body 含 `plugins.superpowers: false`。

## 10. 错误与空态

| 情况 | 表现 |
|---|---|
| settings 缺失/损坏 | 默认开启，损坏打 warn |
| PATCH 非法 | 400 `{ error }` |
| 插件目录缺失 | 日志 error，当关闭，会话照常 |
| SessionStart hook 失败 | 不阻断会话（SDK/SDD 同样） |
| PATCH 网络失败 | 开关回滚，页内错误文案 |
