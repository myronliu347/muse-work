# Server HTTP 层 Hono 化与目录重组

**日期**：2026-08-15  
**状态**：已实现  
**范围**：`packages/server` — 用 Hono 替换原生 `http.createServer` 路由；按 `services/`、`utils/`、`constants/` 重组源码

## 1. 目标

1. **路由可维护性**：删除 `app.ts` 中 ~300 行 `if/match` 手写路由，改为 Hono 声明式路由与子应用挂载。
2. **目录清晰**：业务逻辑进 `services/`，纯工具进 `utils/`，魔法值进 `constants/`；`routes/` 只做 HTTP 绑定。
3. **零 API 变更**：所有 HTTP 路径、方法、JSON 响应格式与状态码保持不变；现有 `fetch` 集成测试无需改断言。
4. **WebSocket 不变**：`wsHub` 仍通过 `node:http.Server` 的 `upgrade` 事件工作，不改用 Hono WS。

## 2. 决策摘要

| 项 | 选择 |
|---|---|
| HTTP 框架 | [Hono](https://hono.dev) v4 + `@hono/node-server` |
| 迁移策略 | 方案 B：路由 + handler 全面 Hono 化（非 adapter 桥接） |
| Node 集成 | `createServer(getRequestListener(app.fetch))`，保留 `Server.listen()` 供 desktop / 测试使用 |
| 上下文注入 | Hono `Variables`：`c.get("ctx")` 取得 `AppContext` |
| 错误格式 | 保持 `{ error: string }`；500 由 `app.onError` 统一处理 |
| 请求体 | `c.req.json()` 替代 `readJsonBody` |
| 删除文件 | `src/http.ts`（`sendJson` / `sendError` / `readJsonBody`） |

## 3. 新目录结构

```text
packages/server/src/
├── index.ts                 # CLI 入口（基本不变）
├── app.ts                   # createHonoApp + createApp（Hono 组装）
├── honoEnv.ts               # Hono Variables 类型定义
│
├── constants/
│   ├── agent.ts             # AGENT_IDLE_TTL_MS, TURN_STALL_MS, EMPTY_TURN_ERROR, DEFAULT_TITLE, TITLE_MAX_LEN
│   ├── musePrompt.ts        # MUSE_BASE_SYSTEM_PROMPT, MUSE_IDENTITY_REV
│   └── slashCommands.ts     # SYSTEM_SLASH_COMMANDS
│
├── middleware/
│   ├── injectCtx.ts         # 注入 AppContext
│   └── accessLog.ts         # HTTP 访问日志（替代 attachAccessLog）
│
├── routes/                  # 薄路由层：解析请求 → 调 service → c.json()
│   ├── auth.ts
│   ├── control.ts
│   ├── health.ts
│   ├── providers.ts
│   ├── sessions.ts
│   └── settings.ts
│
├── services/                # 有状态 / 编排 / 领域逻辑
│   ├── appContext.ts        # createAppContext, createSessionServices, AppContext（原 createAppContext.ts）
│   ├── sessionStore.ts
│   ├── sessionRunner.ts
│   ├── wsHub.ts
│   ├── wsEvents.ts
│   ├── museSettings.ts      # settings.json 读写与 superpowers 插件路径
│   └── museSystemPrompt.ts  # buildMuseIdentityPrompt, patchAgentSystemPrompt 等
│
└── utils/                   # 无领域状态的纯工具 / 基础设施
    ├── logger.ts
    ├── messageMapper.ts
    ├── shutdown.ts
    ├── paths.ts             # resolveHome, getSettingsPath, resolveSuperpowersPluginDir*
    └── runnerError.ts       # sendRunnerError → toRunnerErrorResponse（供 routes 使用）
```

### 3.1 文件迁移对照

| 现路径 | 新路径 | 说明 |
|---|---|---|
| `createAppContext.ts` | `services/appContext.ts` | 仅移动 + 更新 import |
| `sessionStore.ts` | `services/sessionStore.ts` | 仅移动 |
| `sessionRunner.ts` | `services/sessionRunner.ts` | 移动；常量提取到 `constants/agent.ts` |
| `wsHub.ts` | `services/wsHub.ts` | 仅移动 |
| `wsEvents.ts` | `services/wsEvents.ts` | 仅移动 |
| `museSettings.ts` | `services/museSettings.ts` | 移动；路径 helper 抽到 `utils/paths.ts` |
| `museSystemPrompt.ts` | `services/museSystemPrompt.ts` | 移动；字符串常量抽到 `constants/musePrompt.ts` |
| `logger.ts` | `utils/logger.ts` | 仅移动 |
| `messageMapper.ts` | `utils/messageMapper.ts` | 仅移动 |
| `shutdown.ts` | `utils/shutdown.ts` | 仅移动 |
| `http.ts` | — | **删除** |
| `routes/sessions.ts` 内 `SYSTEM_SLASH_COMMANDS` | `constants/slashCommands.ts` | 提取 |
| `app.ts` | `app.ts` | **重写**为 Hono 组装 |

### 3.2 分层职责

**routes/** — 只做：
- HTTP 方法 / 路径绑定
- 读 `c.req.json()`、`c.req.param()`、`c.req.query()`
- 调用 `services/*`
- `return c.json(body)` 或 `return c.json({ error }, status)`

**services/** — 包含：
- 会话持久化（`sessionStore`）
- Agent 运行时（`sessionRunner`）
- WebSocket 广播（`wsHub`）
- 设置读写（`museSettings`）
- 应用 DI（`appContext`）
- System prompt 构建（`museSystemPrompt`）

**utils/** — 包含：
- 日志（`logger`）
- 消息映射（`messageMapper`）
- 优雅关闭（`shutdown`）
- 路径解析（`paths`）
- Runner 错误 → HTTP status 映射（`runnerError`）

**constants/** — 仅导出常量，不含函数。

## 4. Hono 架构

### 4.1 类型

```typescript
// honoEnv.ts
export type HonoEnv = {
  Variables: { ctx: AppContext };
};
```

### 4.2 App 组装

```typescript
// app.ts
export function createHonoApp(ctx: AppContext): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", injectCtx(ctx));
  app.use("*", accessLog);
  app.route("/", healthRoutes);
  app.route("/", settingsRoutes);
  app.route("/", controlRoutes);
  app.route("/", providersRoutes);
  app.route("/", authRoutes);
  app.route("/", sessionsRoutes);
  app.notFound(/* 404 { error } */);
  app.onError(/* 500 { error } + log */);
  return app;
}

export function createApp(ctx: AppContext): Server {
  const server = createServer(getRequestListener(createHonoApp(ctx).fetch));
  ctx.hub.attach(server);
  return server;
}
```

### 4.3 Middleware

| Middleware | 作用 |
|---|---|
| `injectCtx` | 每个请求 `c.set("ctx", ctx)` |
| `accessLog` | `/health` → debug，其余 → info；记录 method、path、status、ms |

### 4.4 路由挂载

各 route 文件 export `new Hono<HonoEnv>()` 实例，在 `app.ts` 用 `app.route("/", xxxRoutes)` 挂载。

**sessions 嵌套示例**：

```text
GET    /sessions
POST   /sessions
GET    /sessions/:sessionId
PATCH  /sessions/:sessionId
DELETE /sessions/:sessionId
POST   /sessions/:sessionId/select
GET    /sessions/:sessionId/messages
POST   /sessions/:sessionId/messages
POST   /sessions/:sessionId/abort
POST   /sessions/:sessionId/compact
POST   /sessions/:sessionId/clear
GET    /sessions/:sessionId/rewind-checkpoints
POST   /sessions/:sessionId/rewind
GET    /sessions/:sessionId/slash-commands
GET    /sessions/:sessionId/status
GET    /sessions/:sessionId/mcp
POST   /sessions/:sessionId/mcp/:name/connect
POST   /sessions/:sessionId/mcp/:name/disconnect
GET    /sessions/:sessionId/background-tasks
GET    /sessions/:sessionId/background-tasks/:taskId/output
POST   /sessions/:sessionId/background-tasks/:taskId/stop
GET    /sessions/:sessionId/workflows
POST   /sessions/:sessionId/workflows/:runId/stop
POST   /sessions/:sessionId/permissions/:requestId
```

实现方式：`sessionsRoutes.route("/sessions/:sessionId", sessionSubRoutes)`。

路径参数由 Hono 自动 decode，不再手动 `decodeURIComponent`。

### 4.5 Handler 改写模式

**Before**（settings）：

```typescript
export async function handlePatchSettings(req, res, ctx) {
  const body = await readJsonBody(req);
  if (typeof body?.plugins?.superpowers !== "boolean") {
    sendError(res, 400, "...");
    return;
  }
  sendJson(res, 200, patchMuseSettings(...));
}
```

**After**：

```typescript
settingsRoutes.patch("/settings", async (c) => {
  const ctx = c.get("ctx");
  const body = await c.req.json<{ plugins?: { superpowers?: unknown } }>();
  if (typeof body?.plugins?.superpowers !== "boolean") {
    return c.json({ error: "..." }, 400);
  }
  const settings = patchMuseSettings(..., ctx.home);
  ctx.runner.invalidateAgentIdentities();
  return c.json(settings);
});
```

### 4.6 Runner 错误处理

`sessions` 路由中多处 `try/catch` + `sendRunnerError`。提取到 `utils/runnerError.ts`：

```typescript
export function runnerErrorStatus(err: unknown): number { /* 读 statusCode 或 500 */ }
export function runnerErrorMessage(err: unknown): string { /* Error.message 或 String */ }
```

路由中：

```typescript
try {
  return c.json(await ctx.runner.compact(sessionId));
} catch (err) {
  return c.json({ error: runnerErrorMessage(err) }, runnerErrorStatus(err));
}
```

## 5. 依赖变更

`packages/server/package.json` 新增：

```json
{
  "dependencies": {
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0"
  }
}
```

版本以安装时 lockfile 为准，上值为起始目标。

## 6. 不变项

| 项 | 说明 |
|---|---|
| `index.ts` | `server.listen(port, HOST)` + stdout JSON ready 行 |
| `wsHub.attach(server)` | upgrade 路径 `/ws?sessionId=` |
| `utils/shutdown.ts` | `server.close()` 签名不变 |
| `tests/helpers.ts` | `listenTestApp` / `closeTestApp` 不变 |
| 所有 HTTP API | 路径、方法、响应 JSON 结构不变 |
| `plugins/` | superpowers 插件目录不动 |

## 7. 测试策略

1. 更新所有 test / src 文件的 import 路径（`../src/sessionRunner.js` → `../src/services/sessionRunner.js` 等）。
2. 跑 `pnpm --filter @muse-work/server test`，全部通过即完成。
3. 跑 `pnpm --filter @muse-work/server type-check`。
4. 不新增框架级单元测试；现有集成测试覆盖 API 契约。

## 8. 实现顺序

1. 加依赖；建 `constants/`、`utils/paths.ts`、`utils/runnerError.ts`、`honoEnv.ts`、`middleware/`。
2. 移动 `services/` 与 `utils/` 文件，更新内部 import；从源文件提取常量。
3. 重写 `routes/*.ts` 为 Hono 子路由。
4. 重写 `app.ts`；删除 `http.ts`。
5. 批量更新 `tests/` import 路径。
6. `type-check` + `test` 验证。

## 9. 不在范围

- WebSocket 改用 Hono 内置 WS
- 请求体 zod / valibot 校验
- CORS（localhost-only，不需要）
- `routes/sessions.ts` 拆成多文件（可后续做；本轮保持单文件 + 嵌套 Hono）
- 修改 webview / desktop 客户端

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| import 路径大面积变更导致遗漏 | 用 `tsc --noEmit` 和全量 test 兜底 |
| Hono path param 与旧 regex 行为差异 | 集成测试覆盖带特殊字符的 sessionId（若有） |
| `c.req.json()` 空 body 抛错 | 与旧 `readJsonBody` 对齐：catch 或 `try/catch` 当 `undefined` 处理 |
| Access log status 读取 | 使用 `c.res.status`（Hono 4 标准写法） |

## 11. 验收标准

- [ ] `app.ts` 无手写路由 if/match
- [ ] `http.ts` 已删除
- [ ] 目录符合 §3 结构
- [ ] `pnpm --filter @muse-work/server type-check` 通过
- [ ] `pnpm --filter @muse-work/server test` 全部通过
- [ ] desktop 启动 server 仍能从 stdout 读到 `{ ready: true, port, host }`
