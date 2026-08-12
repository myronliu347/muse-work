# Muse Work MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Muse Work MVP：精简 Electron 壳 + HTTP/WS server（包装 `wave-agent-sdk`）+ 可插拔 Provider（CodeMaker + OpenAI 兼容），支持多 model 选择与本地对话。

**Architecture:** `packages/desktop` 启动时 spawn `packages/server`；UI（fork 自 wave `webview`）经本机 HTTP/WS 通信；`packages/provider` 解析凭证/模型/网关；server 用解析结果调用 `Agent.create` / `sendMessage`。

**Tech Stack:** pnpm monorepo、TypeScript、Node 20+、Electron、React 18、Vitest、`wave-agent-sdk@1.0.7`、原生 `http` + `ws`

**Spec:** `docs/superpowers/specs/2026-08-12-muse-work-design.md`

## Global Constraints

- `wave-agent-sdk` 仅 `packages/server` 依赖，版本 `1.0.7`（npm）
- server 仅监听 `127.0.0.1`
- 凭证目录：`~/.muse-work/`（auth `0600`）；可只读复用 `~/.local/share/codemaker/auth.json`
- MVP 不做：SSH、分屏、预览、差异/终端面板、Wave SSO/企业控制台/更新通道
- 包管理器：pnpm；测试：Vitest
- 品牌名：Muse Work；userData / 配置根：`muse-work`

## File Structure

```text
muse-work/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/
    provider/
      package.json
      src/
        types.ts
        paths.ts
        configStore.ts
        registry.ts
        openaiCompatible.ts
        codemaker/
          types.ts
          credentials.ts
          sign.ts
          login.ts
          provider.ts
        index.ts
      tests/
        configStore.test.ts
        openaiCompatible.test.ts
        credentials.test.ts
        sign.test.ts
        provider.codemaker.test.ts
    server/
      package.json
      src/
        index.ts
        app.ts
        types.ts
        sessionStore.ts
        sessionRunner.ts
        wsHub.ts
        routes/
          health.ts
          providers.ts
          auth.ts
          sessions.ts
      tests/
        health.test.ts
        providers.routes.test.ts
        sessions.ws.test.ts
    webview/
      package.json
      src/                 # forked from wave-webview, then slimmed
        muse/
          apiClient.ts
          wsClient.ts
        ...
      tests/
        apiClient.test.ts
    desktop/
      package.json
      src/
        main/
          index.ts
          serverProcess.ts
          window.ts
      tests/
        serverProcess.test.ts
```

---

### Task 1: Monorepo 脚手架

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/provider/package.json`
- Create: `packages/server/package.json`
- Create: `packages/webview/package.json`
- Create: `packages/desktop/package.json`
- Create: `packages/provider/src/index.ts`
- Create: `packages/server/src/index.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: none
- Produces: pnpm workspace 可 `pnpm install`；四个 package name：`@muse-work/provider`、`@muse-work/server`、`@muse-work/webview`、`@muse-work/desktop`

- [ ] **Step 1: 写根配置**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

根 `package.json`:

```json
{
  "name": "muse-work",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "type-check": "pnpm -r type-check",
    "dev:server": "pnpm -F @muse-work/server dev",
    "dev:desktop": "pnpm -F @muse-work/desktop dev"
  },
  "engines": {
    "node": ">=20"
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`.gitignore`:

```gitignore
node_modules
dist
release
.DS_Store
*.log
coverage
.vite
webview/dist
```

- [ ] **Step 2: 建四个 package 的 package.json（最小可 build）**

`packages/provider/package.json`:

```json
{
  "name": "@muse-work/provider",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/server/package.json`（先不装 SDK，Task 7 再加）:

```json
{
  "name": "@muse-work/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "muse-server": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@muse-work/provider": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.18.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/webview/package.json` 与 `packages/desktop/package.json` 先放同结构的占位（name 分别为 `@muse-work/webview` / `@muse-work/desktop`，scripts 含 `build`/`test`/`type-check` 的 `echo ok` 或空 tsc），后续 Task 9/10 替换为真实 fork 配置。

每个包加 `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

`packages/provider/src/index.ts` / `packages/server/src/index.ts`:

```ts
export {};
```

- [ ] **Step 3: 安装并验证**

Run:

```bash
cd /Users/liuyuyang/Documents/projects/codes/muse-work && pnpm install && pnpm -F @muse-work/provider build && pnpm -F @muse-work/server build
```

Expected: 安装成功，两个包 `dist/` 生成

- [ ] **Step 4: 写 README 骨架**

`README.md` 说明 monorepo 包职责与 `pnpm test` / `pnpm dev:desktop`（后续任务补齐）。

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml README.md packages
git commit -m "$(cat <<'EOF'
chore: scaffold muse-work pnpm monorepo

Add provider/server/webview/desktop workspace packages and shared TypeScript base config.
EOF
)"
```

---

### Task 2: Provider 类型、路径与配置存储

**Files:**
- Create: `packages/provider/src/types.ts`
- Create: `packages/provider/src/paths.ts`
- Create: `packages/provider/src/configStore.ts`
- Create: `packages/provider/src/registry.ts`
- Create: `packages/provider/src/index.ts`
- Test: `packages/provider/tests/configStore.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `AiProvider`, `AuthStatus`, `ModelInfo`, `GatewayResolution`, `ProvidersFile`, `LoginStart`
  - `getMuseHomeDir(): string`
  - `loadProvidersConfig(home?): ProvidersFile` / `saveProvidersConfig(cfg, home?)`
  - `createProviderRegistry(providers: AiProvider[]): ProviderRegistry` with `get(id)`, `list()`, `getActive()`, `setActive(providerId, modelId)`

- [ ] **Step 1: 写失败测试**

`packages/provider/tests/configStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadProvidersConfig,
  saveProvidersConfig,
} from "../src/configStore.js";

describe("configStore", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns default config when file missing", () => {
    const cfg = loadProvidersConfig(tmp);
    expect(cfg.activeProviderId).toBe("codemaker");
    expect(cfg.providers.codemaker.models.length).toBeGreaterThan(0);
    expect(cfg.providers["openai-compatible"]).toBeDefined();
  });

  it("round-trips active model selection", () => {
    const cfg = loadProvidersConfig(tmp);
    cfg.activeProviderId = "openai-compatible";
    cfg.activeModelId = "gpt-4.1";
    saveProvidersConfig(cfg, tmp);
    const again = loadProvidersConfig(tmp);
    expect(again.activeProviderId).toBe("openai-compatible");
    expect(again.activeModelId).toBe("gpt-4.1");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm -F @muse-work/provider test`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现类型与 configStore**

`packages/provider/src/types.ts` — 按 spec §4.1 定义 `AuthStatus`（`{ state: "authenticated" | "unauthenticated" | "needs_config" | "expired"; user?: string; providerId: string }`）、`LoginStart`、`ModelInfo`、`GatewayResolution`、`AiProvider`、`ProvidersFile`。

`packages/provider/src/paths.ts`:

```ts
import os from "node:os";
import path from "node:path";

export function getMuseHomeDir(home = os.homedir()): string {
  return path.join(home, ".muse-work");
}

export function getProvidersConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "providers.json");
}

export function getCodeMakerAuthPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "auth", "codemaker.json");
}

export function getSharedCodeMakerAuthPath(home = os.homedir()): string {
  return path.join(home, ".local", "share", "codemaker", "auth.json");
}
```

`configStore.ts`：缺失文件时返回默认 `ProvidersFile`（含 codemaker 若干 model + openai-compatible 示例 models）；`save` 时 `mkdir` + 写 JSON。

`registry.ts`：内存 registry，active 读写委托 `configStore`。

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm -F @muse-work/provider test`

- [ ] **Step 5: Commit**

```bash
git add packages/provider
git commit -m "$(cat <<'EOF'
feat(provider): add types, paths, and providers.json store

Establish AiProvider contracts and default multi-model provider config.
EOF
)"
```

---

### Task 3: OpenAI-compatible Provider

**Files:**
- Create: `packages/provider/src/openaiCompatible.ts`
- Modify: `packages/provider/src/index.ts`
- Test: `packages/provider/tests/openaiCompatible.test.ts`

**Interfaces:**
- Consumes: `AiProvider`, `ProvidersFile` provider entry
- Produces: `createOpenAiCompatibleProvider(options: { getConfig: () => ProvidersFile["providers"]["openai-compatible"]; getApiKey: () => string | undefined }): AiProvider`（`id: "openai-compatible"`）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { createOpenAiCompatibleProvider } from "../src/openaiCompatible.js";

describe("openaiCompatible provider", () => {
  it("lists configured models", async () => {
    const p = createOpenAiCompatibleProvider({
      getConfig: () => ({
        enabled: true,
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: [
          { id: "gpt-4.1", label: "GPT-4.1" },
          { id: "gpt-4.1-mini", label: "Mini" },
        ],
      }),
      getApiKey: () => "sk-test",
    });
    const models = await p.listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
  });

  it("resolveGateway returns bearer-ready config", async () => {
    const p = createOpenAiCompatibleProvider({
      getConfig: () => ({
        enabled: true,
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
        models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
      }),
      getApiKey: () => "sk-test",
    });
    const g = await p.resolveGateway("gpt-4.1");
    expect(g.baseURL).toBe("https://api.example.com/v1");
    expect(g.apiKey).toBe("sk-test");
    expect(g.model).toBe("gpt-4.1");
  });

  it("needs_config when api key missing", async () => {
    const p = createOpenAiCompatibleProvider({
      getConfig: () => ({
        enabled: true,
        baseURL: "https://api.example.com/v1",
        models: [{ id: "gpt-4.1", label: "GPT-4.1" }],
      }),
      getApiKey: () => undefined,
    });
    const s = await p.getAuthStatus();
    expect(s.state).toBe("needs_config");
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: 实现 `createOpenAiCompatibleProvider`**

- `beginLogin` / `completeLogin`：抛出或返回明确错误「该 provider 使用 API Key 配置，无需 SSO」
- `logout`：no-op 或清除内存中的覆盖 key（不删用户文件除非后续加设置 API）
- `getAuthStatus`：有 baseURL + apiKey → `authenticated`，否则 `needs_config`

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/provider
git commit -m "$(cat <<'EOF'
feat(provider): add OpenAI-compatible provider with multi-model list

Prove pluggable gateway resolution via apiKey + baseURL + models[].
EOF
)"
```

---

### Task 4: CodeMaker 凭证加载与优先级

**Files:**
- Create: `packages/provider/src/codemaker/types.ts`
- Create: `packages/provider/src/codemaker/credentials.ts`
- Test: `packages/provider/tests/credentials.test.ts`

**Interfaces:**
- Consumes: `paths.ts`
- Produces:
  - `CodeMaker creds`: `{ accessToken: string; refreshKey?: string; accessUser: string; expire?: number }`
  - `loadCodeMakerCredentials(home?): CodeMakerCreds | null` — 顺序：Muse auth → shared auth.json 的 `netease-codemaker`
  - `saveCodeMakerCredentials(creds, home?): void` — 写 Muse 路径，`chmod 0o600`
  - `isExpired(creds, now = Date.now()): boolean`

- [ ] **Step 1: 写失败测试**（用 temp home，写入两个位置验证优先级）

```ts
it("prefers muse auth over shared codemaker auth", () => {
  // write shared with user A, muse with user B → load returns B
});

it("falls back to shared auth when muse missing", () => {
  // only shared → returns shared
});

it("returns null when both missing", () => {
  expect(loadCodeMakerCredentials(tmp)).toBeNull();
});
```

Shared 文件格式对齐本机：

```json
{
  "netease-codemaker": {
    "type": "api",
    "key": "...",
    "access_token": "...",
    "refresh_key": "...",
    "access_user": "alice",
    "expire": 9999999999999
  }
}
```

Muse 文件可存同一结构或扁平 `CodeMakerCreds`（实现时选一种并在 loader 统一 normalize）。

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: 实现 credentials.ts**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/provider
git commit -m "$(cat <<'EOF'
feat(provider): load CodeMaker credentials with muse-first fallback

Prefer ~/.muse-work/auth/codemaker.json, then shared CodeMaker auth.json.
EOF
)"
```

---

### Task 5: CodeMaker 请求签名与 resolveGateway

**Files:**
- Create: `packages/provider/src/codemaker/sign.ts`
- Create: `packages/provider/src/codemaker/provider.ts`（可先不含 login）
- Create: `packages/provider/scripts/probe-sign.mjs`（开发用，不提交密钥）
- Test: `packages/provider/tests/sign.test.ts`
- Test: `packages/provider/tests/provider.codemaker.test.ts`

**Interfaces:**
- Consumes: `CodeMakerCreds`, `AiProvider`
- Produces:
  - `buildCodeMakerHeaders(creds, parts: { method: string; path: string; timestamp: number; nonce: string }): Record<string, string>`
  - `createCodeMakerFetch(creds, baseFetch?): typeof fetch`
  - `createCodeMakerProvider(deps): AiProvider`（`id: "codemaker"`）
  - `CODEMAKER_BASE_URL = "https://api-code-maker.nie.netease.com"`
  - gateway `baseURL = `${CODEMAKER_BASE_URL}/openai/v1``

**签名说明（实现约束）：**  
本机抓包可见头：`X-Access-Token`、`X-Auth-User`、`X-Timestamp`、`X-Nonce`、`X-Sig-Version: v1`、`X-Signature`（64 hex = SHA256）。实现时：

1. 在 `sign.ts` 把「待签名字符串」与 HMAC key 来源（`refresh_key` 或其它）收成纯函数，便于单测
2. 用 `scripts/probe-sign.mjs` 对候选 canonical 字符串做爆破式比对（仅本地运行，读本机 auth，**禁止把真实 token 写进仓库**）
3. 锁定算法后固化到 `sign.ts`，单测使用固定 timestamp/nonce/key 的向量

若短期无法还原签名：`createCodeMakerFetch` 仍必须挂齐除 `X-Signature` 外的头，并在集成测试中标记；**不得**把错误算法当永久方案——Task 5 完成标准是：对 `/openai/v1/models` 或 `/validate` 的探测请求返回非 `auth failed / signature` 类错误（或单测向量与 probe 一致）。

- [ ] **Step 1: 写 sign 单测（先定接口，向量可先用 stub signer）**

```ts
it("includes required header names", () => {
  const headers = buildCodeMakerHeaders(
    { accessToken: "t", accessUser: "u", refreshKey: "r" },
    { method: "POST", path: "/openai/v1/chat/completions", timestamp: 1, nonce: "abc" },
  );
  expect(headers["X-Access-Token"]).toBe("t");
  expect(headers["X-Auth-User"]).toBe("u");
  expect(headers["X-Sig-Version"]).toBe("v1");
  expect(headers["X-Signature"]).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: 实现 sign + provider.resolveGateway / listModels（读 config）**

- [ ] **Step 3: 本地运行 probe（手工）锁定算法并更新向量测试**

Run: `node packages/provider/scripts/probe-sign.mjs`（脚本内只打印是否 match，不打印 token）

- [ ] **Step 4: `pnpm -F @muse-work/provider test` PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/provider
git commit -m "$(cat <<'EOF'
feat(provider): add CodeMaker signed fetch and gateway resolution

Resolve OpenAI-compatible CodeMaker baseURL with request signing headers.
EOF
)"
```

---

### Task 6: CodeMaker App 内 SSO 登录

**Files:**
- Create: `packages/provider/src/codemaker/login.ts`
- Modify: `packages/provider/src/codemaker/provider.ts`
- Test: `packages/provider/tests/login.test.ts`

**Interfaces:**
- Consumes: `saveCodeMakerCredentials`, `AuthStatus`
- Produces:
  - `beginCodeMakerLogin(opts?): Promise<LoginStart & { waitUntilComplete: () => Promise<AuthStatus> }>`
  - 对齐 CodeMaker CLI：**uuid 轮询**（非本机 `callback_url`）
    1. `authUrl = ${API}/vs_login?ide=cli&uuid=&redirect_uri=vs://cli?uuid=`
    2. poll `GET /vs_login_info/:uuid`（2s / 600s）→ `access_user` + `access_token`
    3. `GET /get_auth_key`（`X-Access-Token`）→ `refresh_key`
    4. `saveCodeMakerCredentials` → `~/.muse-work/auth/codemaker.json`
  - `createCodeMakerProvider.beginLogin/completeLogin/logout` 接到上述实现
  - 若已有有效凭证：`beginLogin` 可返回 `{ reused: true }`

> **修正（2026-08-12）：** 初版 brief 误写 Wave 式本地 callback；以 CLI/Hub 真实流程为准（用户确认方案 A）。

- [x] **Steps 1–5:** 已实现并提交 `49d69b3`；见 `.superpowers/sdd/task-6-report.md`

---

### Task 7: Server — health / providers / auth HTTP

**Files:**
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/src/routes/providers.ts`
- Create: `packages/server/src/routes/auth.ts`
- Create: `packages/server/src/createAppContext.ts`
- Test: `packages/server/tests/health.test.ts`
- Test: `packages/server/tests/providers.routes.test.ts`
- Modify: `packages/server/package.json`（加 `wave-agent-sdk` 可放到 Task 8；本任务仅 provider）

**Interfaces:**
- Consumes: `@muse-work/provider` registry + providers
- Produces:
  - `createApp(ctx): http.Server` 监听 `127.0.0.1`
  - CLI：`muse-server --port 0` 时在 stdout 打印一行 JSON：`{"ready":true,"port":12345,"host":"127.0.0.1"}`
  - 路由按 spec §6.2 的 providers/auth/health

- [ ] **Step 1: 写失败测试**（用 `http.request` 打内存 server）

```ts
it("GET /health returns ok", async () => {
  const { server, baseUrl } = await listenTestApp();
  const res = await fetch(`${baseUrl}/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  server.close();
});

it("GET /providers returns active provider and models", async () => {
  // mount registry with openai-compatible stub
});

it("POST /providers/active switches model", async () => {
  // ...
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: 实现 app + routes**（无框架：Node `http` + 简单 pathname 路由即可）

`createAppContext`：加载 config、实例化 `createCodeMakerProvider` + `createOpenAiCompatibleProvider`、`createProviderRegistry`。

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/server packages/provider
git commit -m "$(cat <<'EOF'
feat(server): expose health, providers, and auth HTTP APIs

Bootstrap localhost server wiring the provider registry for UI control plane.
EOF
)"
```

---

### Task 8: Server — sessions、Agent、WebSocket 流式与权限

**Files:**
- Modify: `packages/server/package.json` — 依赖 `"wave-agent-sdk": "1.0.7"`
- Create: `packages/server/src/sessionStore.ts`
- Create: `packages/server/src/sessionRunner.ts`
- Create: `packages/server/src/wsHub.ts`
- Create: `packages/server/src/routes/sessions.ts`
- Test: `packages/server/tests/sessions.ws.test.ts`

**Interfaces:**
- Consumes: `AiProvider.resolveGateway`, `Agent` from `wave-agent-sdk`
- Produces:
  - `Session = { id: string; workdir: string; createdAt: number; status: "idle" | "running" | "error" }`
  - `POST /sessions` body `{ workdir: string }` → session
  - `POST /sessions/:id/messages` body `{ content: string }` → `{ accepted: true }`
  - `WS /ws?sessionId=` 推送：
    - `{ type: "message:delta", text: string }`
    - `{ type: "message:completed" }`
    - `{ type: "permission:request", permissionId: string, toolName: string, description: string }`
    - `{ type: "session:status", status }`
    - `{ type: "auth:changed", status: AuthStatus }`
  - `POST /sessions/:id/permissions/:permissionId` body `{ decision: "allow" | "deny" }`
  - `sessionRunner`：`Agent.create({ apiKey, baseURL, defaultHeaders, fetch, model, workdir, stream: true, callbacks, canUseTool })` 后 `sendMessage(content)`；把 SDK callbacks 映射为 WS 事件

- [ ] **Step 1: 写失败测试（mock Agent）**

在 `sessionRunner` 注入 `createAgent` factory，测试中 fake：

```ts
const fakeAgent = {
  sendMessage: async () => {
    emit({ type: "message:delta", text: "hi" });
    emit({ type: "message:completed" });
  },
  dispose: async () => {},
};
```

断言：POST message 后 WS 客户端收到 delta + completed。

另测：`canUseTool` 挂起 → WS 收到 `permission:request` → POST allow → Promise resolve。

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: 实现 store / hub / runner / routes**

注意：

- 每 session 一个 Agent；销毁 session 时 dispose
- 发消息前 `resolveGateway(activeModelId)`；捕获 401 → 广播 `auth:changed` 且 session status error
- 不要设置 `serverUrl`（避免误走 Wave SSO）

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: 手工冒烟（可选）**

```bash
pnpm -F @muse-work/server dev -- --port 8787
# curl health / create session / wscat 收流
```

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "$(cat <<'EOF'
feat(server): run wave-agent-sdk sessions over HTTP and WebSocket

Stream agent output and permission prompts to localhost UI clients.
EOF
)"
```

---

### Task 9: Fork 并精简 webview + Muse HTTP/WS 客户端

**Files:**
- Copy from: `/Users/liuyuyang/Documents/projects/codes/wave-agent/packages/webview` → `packages/webview`（覆盖占位）
- Create: `packages/webview/src/muse/apiClient.ts`
- Create: `packages/webview/src/muse/wsClient.ts`
- Create: `packages/webview/src/muse/hostBridge.ts`
- Modify: webview 入口与 `ChatApp` / `MoreMenu` / `WelcomeView`（去掉 Wave 企业控制台；登录走 Muse API）
- Modify: `packages/webview/package.json`（去掉对 wave 其它包的 workspace 耦合；保留 React 构建）
- Test: `packages/webview/tests/apiClient.test.ts`

**Interfaces:**
- Consumes: server HTTP/WS（Task 7–8）
- Produces:
  - `MuseApiClient`：`getHealth`, `listProviders`, `setActive`, `getAuthStatus`, `login`, `logout`, `createSession`, `sendMessage`, `respondPermission`
  - `MuseWsClient`：`connect(sessionId)`, `onEvent(handler)`
  - `hostBridge`：向现有 webview 消息层提供与旧 `postMessage` 命令兼容的适配（最小集：`login`/`logout`/`sendMessage`/permission 响应），以便少改 UI

- [ ] **Step 1: 复制源码**

```bash
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude coverage \
  /Users/liuyuyang/Documents/projects/codes/wave-agent/packages/webview/ \
  /Users/liuyuyang/Documents/projects/codes/muse-work/packages/webview/
```

修正 `package.json` name 为 `@muse-work/webview`，移除 `wave-webview-fixtures` 等非必需依赖；esbuild 入口保持可 build。

- [ ] **Step 2: 写 apiClient 测试并实现**

```ts
it("setActive posts provider and model", async () => {
  const fetches: string[] = [];
  const client = new MuseApiClient({
    baseUrl: "http://127.0.0.1:9",
    fetch: async (url, init) => {
      fetches.push(`${init?.method} ${url}`);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.setActive("codemaker", "deepseek-v4-pro");
  expect(fetches[0]).toContain("/providers/active");
});
```

- [ ] **Step 3: 接线 UI（最小改动集）**

- 删除/隐藏 `more-menu-enterprise`
- `login` / `logout` → `MuseApiClient`
- 增加 model `<select>`：`listProviders` + models → `setActive`
- 欢迎页登录 CTA 看 `getAuthStatus`
- 消息发送与流式：HTTP send + WS events 更新 reducer（可新建 `museReducer` 分支，避免一次重写全部 vscode 协议）

- [ ] **Step 4: `pnpm -F @muse-work/webview test` 与 `build`**

- [ ] **Step 5: Commit**

```bash
git add packages/webview
git commit -m "$(cat <<'EOF'
feat(webview): fork Wave UI onto Muse HTTP/WS client

Strip enterprise console and wire login, models, and chat streaming.
EOF
)"
```

---

### Task 10: Fork 并精简 desktop + 拉起 server

**Files:**
- Copy from: `/Users/liuyuyang/Documents/projects/codes/wave-agent/packages/desktop` → `packages/desktop`
- Create: `packages/desktop/src/main/serverProcess.ts`
- Create: `packages/desktop/src/main/window.ts`（或改现有 index）
- Modify: 移除 `updateAutoUpdater` / `updateChecker` / Wave stdio host 路径；改为加载 webview + `MUSE_SERVER_URL`
- Test: `packages/desktop/tests/serverProcess.test.ts`

**Interfaces:**
- Consumes: `@muse-work/server` bin / `node packages/server/dist/index.js`
- Produces:
  - `startMuseServer(opts: { entry: string; host?: string }): Promise<{ port: number; stop: () => Promise<void> }>`
  - 解析子进程 stdout 中的 ready JSON 行
  - 崩溃自动重启（最多 N 次 / 带退避）
  - BrowserWindow `loadFile` webview；`preload` 注入 `window.museServerBaseUrl`

- [ ] **Step 1: rsync desktop 包并改名 `@muse-work/desktop`**

移除依赖：`electron-updater`（MVP）、wave-agent-sdk（desktop 不再直依赖）、stdio agent 大段代码可先留文件但入口不引用。

- [ ] **Step 2: 写 serverProcess 测试**

用 fixture 脚本代替真 server：

```js
// tests/fixtures/fake-server.mjs
console.log(JSON.stringify({ ready: true, port: 19191, host: "127.0.0.1" }));
setInterval(() => {}, 1000);
```

断言 `startMuseServer` resolve port `19191`，`stop` 后进程退出。

- [ ] **Step 3: 实现 spawn + window创建 + 注入 baseUrl**

`package.json` scripts:

```json
{
  "dev": "pnpm -F @muse-work/server build && pnpm -F @muse-work/webview build && pnpm run compile && electron ."
}
```

- [ ] **Step 4: 手工启动桌面冒烟**

Expected：窗口打开 → health ok → 能看到 model 下拉与登录入口

- [ ] **Step 5: Commit**

```bash
git add packages/desktop
git commit -m "$(cat <<'EOF'
feat(desktop): launch Muse server and host slimmed webview

Replace Wave stdio host with localhost HTTP/WS server lifecycle.
EOF
)"
```

---

### Task 11: 品牌、默认配置与 MVP 验收清单

**Files:**
- Modify: desktop `productName` / `appId` → `Muse Work` / `com.muse.work`
- Modify: 默认 `providers.json` 模板与 README 使用说明
- Modify: `docs/superpowers/specs/2026-08-12-muse-work-design.md` 状态可保持；在 README 加验收步骤
- Create: `scripts/smoke-mvp.sh`（可选：curl health + 创建 session）

**Interfaces:**
- Consumes: 全栈
- Produces: README 中可重复的验收步骤；应用显示 Muse Work

- [ ] **Step 1: 替换品牌字符串与图标占位**（无设计稿时用纯色占位图标即可）

- [ ] **Step 2: 按成功标准做手工验收并记录**

1. 冷启动拉起 server，UI 可对话  
2. 复用或完成 CodeMaker 登录  
3. CodeMaker 与 OpenAI-compat 可切换 model  
4. 无 Wave 登录/企业控制台/更新入口  

- [ ] **Step 3: 更新 README（开发命令 + 验收）**

- [ ] **Step 4: Commit**

```bash
git add README.md packages/desktop packages/provider scripts
git commit -m "$(cat <<'EOF'
docs: finalize Muse Work MVP branding and acceptance checklist

Align app identity with Muse Work and document smoke verification steps.
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec 要求 | Task |
|---|---|
| monorepo desktop/webview/server/provider | 1 |
| AiProvider + 多 model 配置 | 2–3 |
| CodeMaker 凭证优先级 | 4 |
| CodeMaker 签名网关 + OpenAI-compat | 3, 5 |
| App 内 SSO 同 CodeMaker | 6 |
| HTTP providers/auth | 7 |
| sessions + SDK + WS + permissions | 8 |
| fork webview，去 Wave 平台依赖，model UI | 9 |
| fork desktop，启动 server | 10 |
| 成功标准 / 品牌 | 11 |
| 不做 SSH/分屏/预览/更新 | 全局约束 + Task 9/10 移除 |

**占位扫描：** CodeMaker 签名与 token exchange URL 需在 Task 5/6 用本机 probe 锁定——计划中已要求固化为代码常量与测试向量，禁止长期 TBD。

**类型一致性：** `AiProvider` / `GatewayResolution` / WS event `type` 字符串在 Task 2/8/9 共用同一字面量。
