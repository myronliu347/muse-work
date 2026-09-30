# Muse Work 设计规格

**日期**：2026-08-12  
**状态**：已评审（对话确认 §1–§5）  
**产品**：Muse Work — AI 工作桌面应用

## 1. 背景与目标

基于 `wave-agent` 的桌面能力打造独立产品 **Muse Work**：

- AI 运行时底层使用 **`wave-agent-sdk`（npm）**
- App 壳参考并 **fork** `wave-agent` 的 `packages/desktop` + `packages/webview`，移除 Wave 平台绑定（登录、企业控制台、更新通知等）
- AI 请求首接 **CodeMaker**（登录方案与 CodeMaker 一致），并抽象可插拔 Provider，便于后续接入其他供应商
- MVP 做精简壳：本地对话 + 工作目录 + Provider 登录/请求；SSH、分屏、预览等后置

## 2. 已确认决策

| 项 | 选择 |
|---|---|
| MVP 范围 | 精简壳（方案 A） |
| 登录 | 混合：优先复用本机 CodeMaker 登录态，否则 App 内 SSO（与 CodeMaker 同方案），凭证写入 Muse 自有目录 |
| Agent 运行时 | 独立 **server 层**包装 `wave-agent-sdk`，App 启动时拉起 |
| 通信 | 本地 **HTTP + WebSocket**（不复用 Wave stdio JSON-RPC） |
| 仓库 | 独立 monorepo：`desktop` / `webview` / `server` / `provider` |
| Provider | CodeMaker + 通用 OpenAI 兼容；每个 provider 可配置多个 model，供 UI 选择 |
| 架构 | Server 为中心 + Provider 插件 |

## 3. 整体架构与包边界

```text
┌─────────────────────────────────────────────┐
│  packages/desktop (Electron)                │
│   · 启动/守护 muse-server                   │
│   · 窗口、工作目录选择、本地文件能力         │
│   · 加载 packages/webview                   │
└──────────────────┬──────────────────────────┘
                   │ HTTP + WebSocket
┌──────────────────▼──────────────────────────┐
│  packages/server                            │
│   · 会话 / 消息流 / 权限确认                 │
│   · 组装 wave-agent-sdk Agent               │
│   · 调用 provider 解析凭证与模型             │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
 packages/provider      wave-agent-sdk (npm)
  · CodeMaker            · Agent / Tools
  · OpenAI-compat
```

| 包 | 职责 | 不负责 |
|---|---|---|
| `desktop` | 进程生命周期、原生壳、fork 后去除 Wave 平台依赖 | AI 逻辑、登录协议细节 |
| `webview` | 对话 UI、model 选择、登录入口 | 直接调用外部 AI API |
| `server` | 唯一 Agent 宿主；对 UI 提供 HTTP/WS | UI 渲染 |
| `provider` | 登录/凭证/模型目录/请求头与 baseURL | 会话状态、工具执行 |

依赖约定：

- `wave-agent-sdk` **仅**由 `server` 依赖（npm）
- `provider` 不依赖 Electron / React，可单测
- MVP **不做**：SSH、分屏、预览、差异/终端面板、Wave 更新通道、企业控制台

## 4. Provider 接口与多 Model 配置

### 4.1 核心接口（`packages/provider`）

```ts
interface AiProvider {
  id: string; // "codemaker" | "openai-compatible"
  displayName: string;

  getAuthStatus(): Promise<AuthStatus>;
  beginLogin(opts?): Promise<LoginStart>; // { authUrl } | { reused: true }
  completeLogin(input): Promise<AuthStatus>;
  logout(): Promise<void>;

  listModels(): Promise<ModelInfo[]>;

  resolveGateway(modelId: string): Promise<GatewayResolution>;
}

interface ModelInfo {
  id: string; // 发给 API 的 model 名
  label: string; // UI 展示
  capabilities?: { vision?: boolean; thinking?: boolean };
  group?: string; // 可选分组
}

interface GatewayResolution {
  apiKey?: string;
  baseURL: string; // 如 .../openai/v1
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch; // CodeMaker 签名可挂在自定义 fetch
  model: string;
  fastModel?: string;
}
```

### 4.2 配置（每 provider 多个 model）

路径：`~/.muse-work/providers.json`（示意）：

```json
{
  "activeProviderId": "codemaker",
  "activeModelId": "deepseek-v4-pro",
  "providers": {
    "codemaker": {
      "enabled": true,
      "models": [
        { "id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro" },
        { "id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6" }
      ]
    },
    "openai-compatible": {
      "enabled": true,
      "baseURL": "https://api.example.com/v1",
      "apiKeyEnv": "MUSE_OPENAI_API_KEY",
      "models": [
        { "id": "gpt-4.1", "label": "GPT-4.1" },
        { "id": "gpt-4.1-mini", "label": "GPT-4.1 Mini" }
      ]
    }
  }
}
```

### 4.3 内置 Provider

| Provider | 凭证 | `resolveGateway` |
|---|---|---|
| **CodeMaker** | 见 §5；请求带签名头（`X-Access-Token` / `X-Auth-User` / `X-Timestamp` / `X-Nonce` / `X-Signature` 等） | `baseURL = https://api-code-maker.nie.netease.com/openai/v1` |
| **OpenAI-compat** | `apiKey` 或环境变量；无复杂登录 | 用户配置的 `baseURL` + Bearer |

### 4.4 UI 选择规则

- 输入区/设置：**Provider → Model**（MVP 可先做「当前 provider 下的 model 下拉」）
- 切换 model 只影响后续请求；进行中的生成不中途更换
- CodeMaker model 列表：配置文件优先；为空时可回退远端/CLI 目录（实现阶段定，接口已支持）

### 4.5 扩展

新供应商 = 实现 `AiProvider` + 注册到 server 的 provider registry；**不必改** webview 消息协议（UI 只消费 `listProviders` / `listModels`）。

## 5. 登录流与凭证优先级

### 5.1 CodeMaker 凭证解析顺序

```text
1. ~/.muse-work/auth/codemaker.json    （App 自己登录写入）
2. ~/.local/share/codemaker/auth.json  （复用本机 CodeMaker / Hub 登录态）
3. 均无或已过期 → 触发 beginLogin()
```

补充规则：

- 有效 token → 已登录，可 `resolveGateway`
- 过期且有 `refresh_key` → provider 内 refresh，成功回写 **Muse 自有** auth 文件（不强制改写 CodeMaker 原文件）
- refresh 失败 → 未登录

### 5.2 App 内登录（与 CodeMaker CLI 同方案）

对齐 CodeMaker CLI `NetEaseCodeMakerAuthPlugin`（**uuid 轮询**，不是 Wave 式本机 `callback_url`）：

```text
1. UI「登录」→ POST /auth/login → beginLogin()
2. uuid = randomUUID()
3. 浏览器打开
   https://api-code-maker.nie.netease.com/vs_login
     ?ide=cli&uuid=<uuid>&redirect_uri=vs://cli?uuid=<uuid>
4. 轮询 GET /vs_login_info/<uuid>（间隔 2s，最长 600s）
   直到返回 access_user + access_token
5. GET /get_auth_key（Header: X-Access-Token）→ auth_key 作为 refresh_key
6. 写入 ~/.muse-work/auth/codemaker.json（0600）
7. 推送 auth:changed → webview 更新登录态
```

说明：`https://auth.nie.netease.com/api/v2/tokens` 仅用于 CLI env-key 换票，**不是**浏览器 SSO 路径。

### 5.3 OpenAI-compat

- 设置中配置 `baseURL` + `apiKey`（或 env 名）
- 有可用 key 则为 ready，否则 `needs_config`

### 5.4 与 Wave 旧登录切割

从 fork 代码中移除：

- Wave SSO（`~/.wave/auth.json`、`MUSE_SERVER_URL`、企业控制台入口）
- 欢迎页/更多菜单中的 Wave 企业控制台
- 绑定 Wave 服务端的更新通知 / telemetry

替换为 Muse `/auth/*` 与当前 provider 状态。

### 5.5 安全

- token 仅存用户目录；不进仓库、不上报明文
- server 仅监听 `127.0.0.1`
- webview 不持有长期 token，一律经 server

## 6. Server API 与数据流

### 6.1 进程

- desktop 启动时 spawn `muse-server`
- 监听 `127.0.0.1:<port>`，port 经 stdout 或临时文件回传主进程
- App 退出时杀掉 server 子进程

### 6.2 HTTP（控制面）

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/health` | 就绪探测 |
| `GET` | `/providers` | 列表 + 当前 active |
| `POST` | `/providers/active` | 切换 provider / model |
| `GET` | `/providers/:id/models` | models 列表 |
| `GET` | `/auth/status` | 登录态 |
| `POST` | `/auth/login` | 开始登录 |
| `POST` | `/auth/logout` | 登出 |
| `GET` | `/sessions` | 会话列表 |
| `POST` | `/sessions` | 新建会话（含 workdir） |
| `GET` | `/sessions/:id` | 详情/历史 |
| `DELETE` | `/sessions/:id` | 删除 |
| `POST` | `/sessions/:id/messages` | 发送用户消息 |
| `POST` | `/sessions/:id/permissions/:pid` | 权限确认/拒绝 |

### 6.3 WebSocket（数据面）

- `WS /ws?sessionId=`
- server → UI：`message:delta` / `message:completed`、`tool:start` / `tool:result`、`permission:request`、`auth:changed`、`session:status`
- MVP 允许「HTTP 发送 + WS 收流」

### 6.4 对话数据流

```text
选 workdir → POST /sessions
选 model → POST /providers/active
发消息 → POST /sessions/:id/messages
server:
  provider.resolveGateway(modelId)
  → Agent.create({ apiKey, baseURL, model, fetch, cwd })
  → 流式结果经 WS 推送
权限 → permission:request → 用户确认 → POST permissions
```

### 6.5 与 wave-agent-sdk

- 每 session 一个 Agent（或等价会话上下文），`cwd` = 会话 workdir
- 每次发送前经当前 provider 解析 gateway；token refresh 后可重试一次
- MVP 使用 SDK 默认工具集

### 6.6 错误处理

- 401 / 签名失败 → `auth_required` + `auth:changed`，UI 引导登录
- provider 未配置 → `needs_config`，引导设置
- server 崩溃 → desktop 自动重启并提示重连；未完成流式消息标失败

## 7. UI 改造范围

### 保留（MVP）

- 工作目录选择与「最近打开」
- 单会话对话：消息列表、流式输出、工具块
- 权限确认
- 基本设置入口

### 改造

- 宿主通信：Wave stdio / `postMessage` 桥 → HTTP + WebSocket client
- 登录/退出：Muse `/auth/*`
- Model 选择：当前 provider 的 `listModels()` → `/providers/active`
- 品牌：Wave → Muse Work（应用名、图标、userData）

### 移除

- Wave SSO / 企业控制台 / `~/.wave` 依赖
- Wave 源更新检查
- SSH、分屏、预览/差异/终端面板（后置）
- 平台通知/telemetry 等 Wave 服务端绑定能力

## 8. 测试策略

| 层 | 内容 |
|---|---|
| `provider` | CodeMaker 凭证优先级、refresh mock、OpenAI-compat resolve、多 model 列表 |
| `server` | 会话 CRUD、WS 事件序列、权限往返、401→auth_required |
| `webview` | model 下拉、登录 CTA、消息流式（mock WS） |
| 手工冒烟 | 启动 → 复用/完成 CodeMaker 登录 → 选目录 → 选 model → 一轮含工具调用的对话 |

## 9. 非目标

- 应用商店分发与完整自动更新方案
- 多窗口 / 多用户
- Provider 市场或远程插件加载
- 强制依赖 CodeMaker Hub 本地代理（`127.0.0.1:15721`）
- 修改 `wave-agent` 上游仓库（消费 npm SDK）

## 10. 成功标准（MVP）

1. 冷启动拉起 server，UI 可对话  
2. 无 Muse 凭证时可复用本机 CodeMaker 登录；否则 App 内 SSO 成功  
3. CodeMaker 与 OpenAI-compat 均可选择不同 model 发请求  
4. 无 Wave 登录 / 企业控制台 / 更新通知残留入口  

## 11. 参考（本机调研摘要）

- CodeMaker 登录态：`~/.local/share/codemaker/auth.json`（provider key：`netease-codemaker`）
- 浏览器 SSO：`https://api-code-maker.nie.netease.com/vs_login` + `/vs_login_info/:uuid` + `/get_auth_key`（`auth.nie` 仅 env-key 换票）
- AI：`https://api-code-maker.nie.netease.com/openai/v1/chat/completions`（OpenAI 兼容）
- 配置 schema 指向：`https://api-code-maker.nie.netease.com/main/config/config.json`
- Wave 参考源码：`/Users/liuyuyang/Documents/projects/codes/wave-agent`（`desktop` / `webview` / `agent-sdk`）
- 本机无 CodeMaker 源码仓库；实现需对照 CLI/Hub 行为与请求头签名细节落地

## 12. 下一步

通过本规格评审后，使用 writing-plans 产出实现计划并开始落地 monorepo 脚手架与 fork。
