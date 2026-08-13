# Muse

Muse 是一个 pnpm monorepo：精简 Electron 壳 + 本地 HTTP/WS server（包装 `wave-agent-sdk`）+ 可插拔 Provider（CodeMaker + OpenAI 兼容），支持多 model 选择与本地对话。

| 包 | 职责 |
|---|---|
| `@muse-work/provider` | Provider 接口、凭证、签名、`providers.json` 配置 |
| `@muse-work/server` | 会话 / 消息流 / 权限；Agent 宿主；HTTP + WebSocket API |
| `@muse-work/webview` | 对话 UI、model 选择、登录入口（fork 自 Wave，去除平台绑定） |
| `@muse-work/desktop` | Electron 壳：冷启动拉起 server、加载 webview（`productName`: **Muse**，`appId`: `com.muse.work`） |

## 要求

- Node.js >= 20
- pnpm 9.15.0

## 开发

```bash
pnpm install

# 构建 / 测试 / 类型检查（全 workspace）
pnpm build
pnpm test
pnpm type-check

# 仅 server（开发模式，可指定端口）
pnpm dev:server
# 等价：pnpm -F @muse-work/server dev -- --port 8787

# 桌面端（构建 server + webview，编译 desktop，启动 Electron）
pnpm dev:desktop
```

### Provider 配置

首次运行若无 `~/.muse-work/providers.json`，server 使用内置默认（与仓库模板一致）：

```bash
mkdir -p ~/.muse-work
cp packages/provider/providers.json.example ~/.muse-work/providers.json
# 编辑 openai-compatible 的 baseURL / apiKeyEnv 等
```

CodeMaker 凭证优先级：`~/.muse-work/auth/codemaker.json` → 本机 CodeMaker 共享 `auth.json`。

OpenAI 兼容 Provider 可通过环境变量注入 API Key（默认 `MUSE_OPENAI_API_KEY`）。

## 自动化冒烟

```bash
chmod +x scripts/smoke-mvp.sh
./scripts/smoke-mvp.sh
```

覆盖：`GET /health`、`GET /providers`、`GET /auth/status`、`POST /sessions`（临时 workdir）。

## MVP 验收清单

### 自动化（CI / 本地）

- [ ] `pnpm test` 全绿
- [ ] `./scripts/smoke-mvp.sh` 通过

### 手工 — 冷启动与对话

- [ ] `pnpm dev:desktop` 冷启动：Electron 窗口标题为 **Muse**，侧边栏/欢迎页无 Wave 品牌文案
- [ ] 主进程日志出现 `server ready at http://127.0.0.1:<port>`
- [ ] 欢迎页可见，输入框可聚焦；发送消息后 UI 有流式/完成反馈（需已登录或 OpenAI-compat 已配置）

### 手工 — 登录

- [ ] 未登录时欢迎页或「更多 → 登录」可发起 CodeMaker SSO
- [ ] 若本机已有 CodeMaker 登录态，应复用（`/auth/status` → `authenticated: true`）
- [ ] 登录后 `GET /auth/status` 返回已认证

### 手工 — Model 切换

- [ ] 顶栏 model 下拉列出 CodeMaker 与 openai-compatible 的 models（来自 `providers.json`）
- [ ] 切换 provider/model 后 `POST /providers/active` 成功，后续对话使用新 model

### 手工 — 已移除的 Wave 能力（应为 **无**）

- [ ] 无 Wave 企业控制台入口
- [ ] 无 Wave 平台 SSO / 更新通知 toast
- [ ] 无 SSH / 分屏 / 预览等 MVP 外功能入口

## 设计规格

详见 [`docs/superpowers/specs/2026-08-12-muse-work-design.md`](docs/superpowers/specs/2026-08-12-muse-work-design.md)。
