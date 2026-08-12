# Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Muse Work 会话管理：`sessions.json` 持久化、侧栏 pin/最近、完整 restore、多会话并发、10min 空闲回收、每会话 model（sender 内选择）、侧栏 loading/dot。

**Architecture:** muse-server 为权威（`~/.muse-work/sessions.json` + 内存 `Map` runtime）。`select` 只改 `activeSessionId`；`ensureAgent` 在发消息/读历史时 restore 或新建。WS 事件一律带 `sessionId`；hostBridge 焦点会话刷聊天区，非焦点刷侧栏状态。UI 侧栏改 pin/最近；model 选择移入 `MessageInput`。

**Tech Stack:** pnpm monorepo、TypeScript、Node 20+、Vitest、`wave-agent-sdk`（`restoreSessionId` / `onSessionIdChange`）、原生 `http` + `ws`、React 18 webview

**Spec:** `docs/superpowers/specs/2026-08-12-session-management-design.md`

## Global Constraints

- 配置根：`~/.muse-work/`；会话索引：`~/.muse-work/sessions.json`
- Server 仅监听 `127.0.0.1`；`MUSE_HOME` 可覆盖 home（测试用）
- `permissionMode` MVP 固定 `"acceptEdits"`
- 切会话不 dispose Agent；空闲 10min 或 DELETE / 进程退出才 destroy
- 不删除 Wave jsonl；不做多 pane / 搜索重命名 / LRU 数量上限
- 包管理器：pnpm；测试：Vitest
- 品牌名：Muse Work

## File Structure

```text
packages/provider/src/paths.ts          # + getSessionsConfigPath
packages/server/src/
  sessionStore.ts                       # 持久化 + Session 扩展字段
  sessionRunner.ts                      # restore / idle TTL / model / unreadDone / getMessages
  messageMapper.ts                      # SDK Message[] → webview 可消费快照
  wsEvents.ts / wsHub.ts                # 事件带 sessionId；支持 * 订阅
  routes/sessions.ts                    # list/patch/select/messages GET
  app.ts                                # 路由挂载
  createAppContext.ts                   # 注入 idleTtlMs / home
packages/webview/src/
  muse/apiClient.ts                     # list/select/patch/delete/getMessages
  muse/wsClient.ts                      # 单连接 + sessionId 过滤
  muse/hostBridge.ts                    # 新建/切换/侧栏树/model PATCH
  components/DesktopSidebar.tsx         # pin/最近 + loading/dot + 图钉
  components/MuseModelSelect.tsx        # 支持受控 session model
  components/MessageInput.tsx           # 嵌入 model 选择
  components/ChatApp.tsx                # 移除顶栏 model；接线 sender
  types/index.ts                        # DesktopSessionEntry.unreadDone / pinned
packages/server/tests/
  sessionStore.persist.test.ts
  sessions.routes.test.ts
  sessionRunner.lifecycle.test.ts
packages/webview/tests/
  muse/apiClient.sessions.test.ts
  muse/hostBridge.sessions.test.ts
  components/DesktopSidebar.sessions.test.tsx
```

---

### Task 1: `sessions.json` 持久化 SessionStore

**Files:**
- Modify: `packages/provider/src/paths.ts`
- Modify: `packages/provider/src/index.ts`（export path helper）
- Modify: `packages/server/src/sessionStore.ts`
- Modify: `packages/server/src/createAppContext.ts`
- Create: `packages/server/tests/sessionStore.persist.test.ts`

**Interfaces:**
- Consumes: `getMuseHomeDir(home)`
- Produces:
  - `getSessionsConfigPath(home?: string): string`
  - `Session` 扩展字段（见下）
  - `SessionStore`: `create` / `get` / `list` / `listGrouped` / `update` / `select` / `setWaveSessionId` / `setUnreadDone` / `updateStatus` / `delete` / `getActiveSessionId`

```ts
export type SessionStatus = "idle" | "running" | "error";

export interface Session {
  id: string;
  waveSessionId?: string;
  title: string;
  workdir: string;
  permissionMode: "acceptEdits";
  model: string;
  pinned: boolean;
  createdAt: number;
  lastActiveAt: number;
  /** runtime only — not required in file */
  status: SessionStatus;
}

export type SessionsFile = {
  version: 1;
  activeSessionId?: string;
  sessions: Array<Omit<Session, "status">>;
};
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/tests/sessionStore.persist.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionStore } from "../src/sessionStore.js";
import { getSessionsConfigPath } from "@muse-work/provider";

describe("sessionStore persistence", () => {
  let home: string;
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("writes sessions.json and reloads activeSessionId + fields", () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sess-"));
    const store1 = createSessionStore({ home });
    const s = store1.create({
      workdir: "/tmp/proj",
      model: "deepseek-v4-flash",
    });
    store1.select(s.id);
    store1.update(s.id, { title: "hello", pinned: true });

    const file = JSON.parse(
      fs.readFileSync(getSessionsConfigPath(home), "utf8"),
    );
    expect(file.version).toBe(1);
    expect(file.activeSessionId).toBe(s.id);
    expect(file.sessions[0].title).toBe("hello");
    expect(file.sessions[0].pinned).toBe(true);
    expect(file.sessions[0].model).toBe("deepseek-v4-flash");
    expect(file.sessions[0].status).toBeUndefined();

    const store2 = createSessionStore({ home });
    expect(store2.getActiveSessionId()).toBe(s.id);
    expect(store2.get(s.id)?.title).toBe("hello");
    expect(store2.listGrouped().pinned[0].id).toBe(s.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server test tests/sessionStore.persist.test.ts`
Expected: FAIL（`getSessionsConfigPath` / `create({model})` / `listGrouped` 不存在）

- [ ] **Step 3: Implement paths + persistent store**

在 `paths.ts` 增加：

```ts
export function getSessionsConfigPath(home = os.homedir()): string {
  return path.join(getMuseHomeDir(home), "sessions.json");
}
```

重写 `sessionStore.ts`：构造时读文件（缺省 `{ version: 1, sessions: [] }`）；`create` / `update` / `select` / `delete` / `setWaveSessionId` 后原子写回（写临时文件再 rename）。`status` 与 `unreadDone` **只存内存**（Map 旁路），不写入 JSON。`listGrouped()`：

```ts
listGrouped(): { pinned: Session[]; recent: Session[]; activeSessionId?: string } {
  const all = this.list();
  const pinned = all.filter((s) => s.pinned).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const recent = all
    .filter((s) => !s.pinned)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, 50);
  return { pinned, recent, activeSessionId: this.activeSessionId };
}
```

`createAppContext`：`createSessionStore({ home: resolveHome(options) })`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/server test tests/sessionStore.persist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/provider/src/paths.ts packages/provider/src/index.ts \
  packages/server/src/sessionStore.ts packages/server/src/createAppContext.ts \
  packages/server/tests/sessionStore.persist.test.ts
git commit -m "$(cat <<'EOF'
feat(server): persist session index to ~/.muse-work/sessions.json

EOF
)"
```

---

### Task 2: HTTP CRUD + select + GET messages（桩）

**Files:**
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/sessionRunner.ts`（先加 `getMessages` 接口，可暂返回 `[]` 直至 Task 3）
- Create: `packages/server/tests/sessions.routes.test.ts`
- Modify: 现有调用 `store.create(workdir)` 的测试 → `store.create({ workdir, model })`

**Interfaces:**
- Consumes: Task 1 `SessionStore`
- Produces:
  - `GET /sessions?grouped=1` → `{ pinned, recent, activeSessionId }`
  - `POST /sessions` body `{ workdir, model?, permissionMode? }`（缺 model 时用 `registry.getActive().modelId`）
  - `PATCH /sessions/:id` body 部分字段
  - `POST /sessions/:id/select` → `{ session, clearedUnread: true }` + 清内存 unreadDone
  - `GET /sessions/:id/messages` → `{ messages: unknown[] }`（本任务可空数组，Task 3 填满）

- [ ] **Step 1: Write the failing route test**

```ts
// packages/server/tests/sessions.routes.test.ts（核心断言）
it("POST create, PATCH pin, POST select, GET grouped", async () => {
  const app = await startTestApp(); // 复用 sessions.ws.test 的 createApp 模式
  const created = await fetch(`${app.baseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workdir: "/tmp/a", model: "m1" }),
  }).then((r) => r.json());
  expect(created.model).toBe("m1");

  await fetch(`${app.baseUrl}/sessions/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinned: true, title: "t1" }),
  });

  await fetch(`${app.baseUrl}/sessions/${created.id}/select`, { method: "POST" });

  const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) =>
    r.json(),
  );
  expect(grouped.activeSessionId).toBe(created.id);
  expect(grouped.pinned[0].title).toBe("t1");
  expect(grouped.recent).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server test tests/sessions.routes.test.ts`
Expected: FAIL（404 on PATCH/select 或 create 不接受 model）

- [ ] **Step 3: Implement handlers + routes**

`handleCreateSession`：读 `workdir`（必填）、`model`（可选→active）、固定 `permissionMode: "acceptEdits"`。  
`handleListSessions`：若 `url.searchParams.get("grouped") === "1"` 返回 `listGrouped()`，否则 `{ sessions: list(), activeSessionId }`。  
`handlePatchSession`：允许 `title | pinned | model | lastActiveAt`。  
`handleSelectSession`：`store.select(id)` + `store.setUnreadDone(id, false)`。  
`handleGetMessages`：`ctx.runner.getMessages(sessionId)`。  
`app.ts` 挂载 `PATCH`、`POST .../select`、`GET .../messages`。

同步修好所有 `store.create("path")` 调用点为对象形式。

- [ ] **Step 4: Run tests**

Run: `pnpm -F @muse-work/server test tests/sessions.routes.test.ts tests/sessions.ws.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/sessions.ts packages/server/src/app.ts \
  packages/server/src/sessionRunner.ts packages/server/tests \
  packages/server/src/sessionStore.ts
git commit -m "$(cat <<'EOF'
feat(server): add session list/patch/select/messages HTTP APIs

EOF
)"
```

---

### Task 3: sessionRunner — restore、配置切换、idle TTL、unreadDone、messages

**Files:**
- Create: `packages/server/src/messageMapper.ts`
- Modify: `packages/server/src/sessionRunner.ts`
- Modify: `packages/server/src/createAppContext.ts`（`idleTtlMs` 可注入，默认 `10 * 60 * 1000`）
- Create: `packages/server/tests/sessionRunner.lifecycle.test.ts`
- Modify: `packages/server/tests/sessionRunner.test.ts`（适配新 create/store API）

**Interfaces:**
- Consumes: `Session.waveSessionId` / `Session.model`；SDK `AgentOptions.restoreSessionId`；`callbacks.onSessionIdChange`
- Produces:
  - `SessionRunner.getMessages(sessionId): Promise<unknown[]>`
  - `ensureAgent`：指纹含 model+gateway；不一致则 destroy → create with restore
  - restore 失败 → 无 restoreSessionId 再建 + 回写 waveSessionId
  - idle 定时器；`markIdle` 时若 `sessionId !== activeSessionId` → `setUnreadDone(true)` + WS `session:unread`
  - `CreateSessionRunnerOptions.idleTtlMs?: number`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
// packages/server/tests/sessionRunner.lifecycle.test.ts
it("restore failure falls back to new agent and writes waveSessionId", async () => {
  const store = createSessionStore({ home });
  const session = store.create({ workdir: "/tmp", model: "m1" });
  store.setWaveSessionId(session.id, "broken-wave-id");

  let calls = 0;
  const runner = createSessionRunner({
    store,
    hub,
    registry,
    idleTtlMs: 60_000,
    createAgent: async (opts) => {
      calls++;
      if (opts.restoreSessionId === "broken-wave-id") {
        throw new Error("restore failed");
      }
      return {
        sendMessage: async () => {},
        dispose: async () => {},
        getMessages: () => [],
        sessionId: "new-wave-id",
      };
    },
  });

  await runner.getMessages(session.id);
  expect(calls).toBe(2);
  expect(store.get(session.id)?.waveSessionId).toBe("new-wave-id");
});

it("idle TTL destroys agent but keeps waveSessionId", async () => {
  // use idleTtlMs: 20, fake timers or real short wait
  // after idle: second getMessages/createAgent should see restoreSessionId again
});

it("model change destroys on next ensure and passes restoreSessionId", async () => {
  // create agent with model m1, PATCH model m2, getMessages → dispose called, create with restore
});

it("sets unreadDone when non-active session becomes idle", async () => {
  // two sessions; finish turn on background → store unread + hub event
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement runner + mapper**

关键改动点（`sessionRunner.ts`）：

1. 扩展 `SessionAgent`：`sessionId?: string`（测试桩）或从真实 Agent 读。
2. `defaultCreateAgent`：透传 `restoreSessionId`；create 后若可读 `agent.sessionId` 写回 store。
3. `ensureAgent`：
   - `resolveGateway(session.model)`（**不是** global active.modelId）
   - 有 `waveSessionId` 时先 `createAgent({ restoreSessionId })`，catch 后无 restore 重试
   - `callbacks.onSessionIdChange: (id) => store.setWaveSessionId(sessionId, id)`
4. 空闲：`Map<sessionId, NodeJS.Timeout>`；`scheduleIdleDestroy` / `clearIdleTimer`；到期 `dispose` runtime **但不** `store.delete`。
5. `markIdle`：清 running；若 `store.getActiveSessionId() !== sessionId` → unreadDone + broadcast `{ type: "session:unread", sessionId, unreadDone: true }`（事件类型在 Task 4 加齐；本任务可先用 `session:status` 扩展字段 `unreadDone`）。
6. `getMessages`：`ensureAgent` → `messageMapper.mapSdkMessages(agent.getMessages?.() ?? [])`。
7. `runTurn` 开头 `touch lastActiveAt`；首条用户消息且 title 仍为默认「新对话」时截断 content 更新 title（或留给 route 层，二选一写清）。

`messageMapper.ts`：MVP 将 SDK message 原样 JSON 可序列化字段输出；hostBridge 用现有 `updateMessages` 消费。若形状不兼容，按 ChatApp `Message` 最小字段 `{ id, role, blocks }` 做薄映射（只映射 user/assistant text + tool blocks）。

- [ ] **Step 4: Run tests**

Run: `pnpm -F @muse-work/server test tests/sessionRunner.lifecycle.test.ts tests/sessionRunner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sessionRunner.ts packages/server/src/messageMapper.ts \
  packages/server/src/createAppContext.ts packages/server/tests/sessionRunner.lifecycle.test.ts \
  packages/server/tests/sessionRunner.test.ts
git commit -m "$(cat <<'EOF'
feat(server): restore agents, idle TTL, and per-session model recreate

EOF
)"
```

---

### Task 4: WebSocket 事件带 `sessionId` + 全局订阅

**Files:**
- Modify: `packages/server/src/wsEvents.ts`
- Modify: `packages/server/src/wsHub.ts`
- Modify: `packages/server/src/sessionRunner.ts`（broadcast 时保证带 sessionId）
- Modify: `packages/webview/src/muse/wsClient.ts`
- Modify: `packages/server/tests/sessions.ws.test.ts`

**Interfaces:**
- Consumes: 现有 `WsEvent` 联合类型
- Produces:
  - 每个下行事件增加 `sessionId: string`
  - `GET /ws` 允许 `sessionId=*`（或省略）订阅全部
  - `MuseWsClient.connect()` 默认连 `*`；handler 收到带 sessionId 的事件
  - 新增 `| { type: "session:unread"; sessionId: string; unreadDone: boolean }`

- [ ] **Step 1: Write failing test**

```ts
it("broadcast includes sessionId and * subscriber receives it", async () => {
  // connect WS to /ws?sessionId=*
  // send message on session A
  // expect first event.sessionId === A
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm -F @muse-work/server test tests/sessions.ws.test.ts`
Expected: FAIL 或断言缺失

- [ ] **Step 3: Implement**

`wsHub.broadcast(sessionId, event)`：

```ts
const payload = JSON.stringify({ ...event, sessionId });
// deliver to clients.get(sessionId) and clients.get("*")
```

upgrade：`sessionId` 缺省视为 `"*"`。  
`wsClient.connect()`：连 `*`；保留 `connect(sessionId)` 重载兼容旧测试可改为连 `*`。  
hostBridge（Task 5）按 `event.sessionId === active` 分流。

- [ ] **Step 4: Run tests**

Run: `pnpm -F @muse-work/server test tests/sessions.ws.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/wsEvents.ts packages/server/src/wsHub.ts \
  packages/server/src/sessionRunner.ts packages/webview/src/muse/wsClient.ts \
  packages/server/tests/sessions.ws.test.ts
git commit -m "$(cat <<'EOF'
feat(ws): tag events with sessionId and support global subscribers

EOF
)"
```

---

### Task 5: apiClient + hostBridge 接线（新建 / 切换 / 树 / 标题）

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`
- Modify: `packages/webview/src/muse/hostBridge.ts`
- Modify: `packages/webview/src/types/index.ts`（`DesktopSessionEntry` 增 `pinned?` / `unreadDone?` / `workdir` 展示字段）
- Create: `packages/webview/tests/muse/apiClient.sessions.test.ts`
- Modify: `packages/webview/tests/muse/hostBridge.test.ts`

**Interfaces:**
- Consumes: Task 2/4 HTTP + WS
- Produces `MuseApiClient` 方法：

```ts
listSessionsGrouped(): Promise<{ pinned: MuseSession[]; recent: MuseSession[]; activeSessionId?: string }>
selectSession(id: string): Promise<{ session: MuseSession }>
patchSession(id: string, patch: Partial<Pick<MuseSession, "title" | "pinned" | "model">>): Promise<MuseSession>
deleteSession(id: string): Promise<{ ok: true }>
getMessages(id: string): Promise<{ messages: unknown[] }>
// createSession(workdir, opts?: { model?: string })
```

hostBridge 行为：

| host command | 动作 |
|---|---|
| `newSession` | `POST /sessions` → select → clear UI → `getMessages` → `updateMessages` → refresh tree → `ws` 已是 `*` |
| select session | `POST select` → `getMessages` → `updateMessages` → 同步 workdir → 清该条 unreadDone → refresh tree |
| delete | `DELETE` → 若删的是当前则新建或选最近一条 |
| pin toggle | `PATCH { pinned }` → refresh |
| `desktopReady` | `listSessionsGrouped` 填树；若有 `activeSessionId` 则 select+messages |
| WS `session:status` / `session:unread` | 更新树条目 `running` / `unreadDone` |
| WS 聊天事件 | 仅当 `event.sessionId === activeSessionId` 时驱动 ChatApp |
| 首条用户消息 accepted | `PATCH title` 截断 |

侧栏树组装：不再按 workdir 大分组；组装为两个伪组或改 ChatApp 传 `{ pinned, recent }`（Task 6 改 Sidebar；本任务可先把 grouped 拍成 `DesktopSessionGroup[]`：两组 `workdir: "pin" | "recent"` 临时，或直接改 props——优先在本任务产出 `buildSidebarModel(grouped)` helper）。

- [ ] **Step 1: Write apiClient + hostBridge tests（mock fetch / stub api）**

覆盖：`listSessionsGrouped` URL；`selectSession` 后 `updateMessages` 被调用；非焦点 `session:status running` 只更新树不 `startStreaming`。

- [ ] **Step 2: Run to verify fail**

Run: `pnpm -F @muse-work/webview test tests/muse/apiClient.sessions.test.ts tests/muse/hostBridge.test.ts`

- [ ] **Step 3: Implement client + bridge**

扩展 `MuseSession` 类型与上面字段对齐。`ensureSession` 改为：优先 `activeSessionId` / 已有 id，否则 create。去掉「每个 session 一条 WS」重连；启动连一次 `*`。

- [ ] **Step 4: Run tests**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/apiClient.ts packages/webview/src/muse/hostBridge.ts \
  packages/webview/src/types/index.ts packages/webview/tests/muse
git commit -m "$(cat <<'EOF'
feat(webview): wire session list/select/messages through hostBridge

EOF
)"
```

---

### Task 6: DesktopSidebar — pin / 最近 / 图钉 / loading / unread dot

**Files:**
- Modify: `packages/webview/src/components/DesktopSidebar.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`（props / handlers：`onTogglePin`；`newSession` 在 streaming 时 **不要** disabled）
- Modify: webview CSS（若有 sidebar 样式文件 / `ChatApp` 全局样式）—— unread dot 与装饰圆点区分
- Create: `packages/webview/tests/components/DesktopSidebar.sessions.test.tsx`（或扩展现有 sidebar 测试）

**Interfaces:**
- Consumes: `DesktopSessionEntry.{ pinned, running, waitingConfirmation, unreadDone }`
- Produces: 两组 UI；悬停图钉；loading / dot 规则（见 spec §7）

- [ ] **Step 1: Write failing UI test**

```tsx
it("shows spinner while running and unread dot when unreadDone", () => {
  render(
    <DesktopSidebar
      sessionTree={[]}
      pinnedSessions={[entry({ sessionId: "a", running: true })]}
      recentSessions={[entry({ sessionId: "b", unreadDone: true })]}
      currentSessionId="a"
      /* ...handlers */
    />,
  );
  expect(screen.getByTestId("desktop-session-item-a").querySelector(".codicon-loading")).toBeTruthy();
  expect(screen.getByTestId("desktop-session-item-b").querySelector(".desktop-session-unread-dot")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement Sidebar**

- 去掉按 workdir 折叠大分组（或保留 workdir **短名**作为条目副标题，不再作 group key）
- 固定渲染 **Pin** / **最近** 两段
- 状态：`running||waiting` → spinner/bell；否则若 `unreadDone && !isCurrent` → `.desktop-session-unread-dot`；焦点或已读 → 无点
- 悬停显示 pin 按钮 → `onTogglePin(sessionId, !pinned)`
- `newSession`：`disabled` 仅在无 workdir 时，**不**因 `isStreaming` 禁用（改 ChatApp `newSessionDisabled`）

- [ ] **Step 4: Run tests + 目视相关单元测试**

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/DesktopSidebar.tsx \
  packages/webview/src/components/ChatApp.tsx packages/webview/tests
git commit -m "$(cat <<'EOF'
feat(ui): pin/recent sidebar with loading and unread-done dots

EOF
)"
```

---

### Task 7: Sender 内每会话 Model + 顶栏移除 + 闭环测试

**Files:**
- Modify: `packages/webview/src/components/MuseModelSelect.tsx`（受控：`modelId` + `onChange(modelId)`；不再写全局 `setActive` 作为会话切换——可选仍刷新列表）
- Modify: `packages/webview/src/components/MessageInput.tsx`（工具条渲染 model select）
- Modify: `packages/webview/src/components/ChatApp.tsx`（移除 header `MuseModelSelect`；传入当前 session.model）
- Modify: `packages/webview/src/muse/hostBridge.ts`（`setSessionModel` → `patchSession`）
- Modify: `packages/server/tests/sessions.ws.test.ts` 或新增集成：两会话不同 model
- Create/Modify: webview 测试断言 PATCH model 不调用 `providers/active`

**Interfaces:**
- Consumes: `PATCH /sessions/:id { model }`；Task 3 配置切换语义
- Produces: sender 显示焦点会话 model；切换会话同步；改 model 后下次 send destroy+restore

- [ ] **Step 1: Write failing tests**

```ts
it("patchSession model does not call providers/active", async () => { /* mock fetch */ });
it("MessageInput renders model select bound to session model", () => { /* render */ });
```

- [ ] **Step 2: Run to verify fail**

- [ ] **Step 3: Implement**

`MuseModelSelect` API：

```tsx
export interface MuseModelSelectProps {
  api?: MuseApiClient;
  modelId?: string;
  onModelChange?: (modelId: string) => void;
  /** default false — when true, also POST /providers/active (settings only) */
  syncGlobalActive?: boolean;
}
```

会话路径：`onModelChange` → hostBridge `patchSession(active, { model })` 更新本地树/当前 session 状态。  
Header 删除 model 控件。  
Settings 里若需要改「新建默认 model」可继续用 `setActive`（已有 Provider 设置页）。

- [ ] **Step 4: Run full package tests**

Run:

```bash
pnpm -F @muse-work/server test
pnpm -F @muse-work/webview test
pnpm -F @muse-work/provider test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/MuseModelSelect.tsx \
  packages/webview/src/components/MessageInput.tsx \
  packages/webview/src/components/ChatApp.tsx \
  packages/webview/src/muse/hostBridge.ts packages/webview/tests
git commit -m "$(cat <<'EOF'
feat(ui): per-session model picker in message sender

EOF
)"
```

---

## Self-Review (spec coverage)

| Spec 项 | Task |
|---|---|
| `sessions.json` + `activeSessionId` | 1 |
| HTTP list/create/get/patch/select/delete/messages | 2 |
| restore / 失败回退 / onSessionIdChange | 3 |
| 配置变更下次 send destroy+restore | 3 |
| 10min idle destroy | 3 |
| 多会话并发 + WS sessionId | 3–4 |
| unreadDone loading/dot | 3, 6 |
| select 清 dot、不 dispose | 2, 5, 6 |
| pin/最近侧栏 | 6 |
| 每会话 model + sender | 7 |
| hostBridge 接线 | 5 |
| 非目标（多 pane/jsonl/LRU…） | 不实现 |

**占位符扫描：** 无 TBD；message 映射在 Task 3 明确为 mapper 文件。  
**类型一致性：** `Session` / `MuseSession` / `DesktopSessionEntry` 字段名统一用 `pinned`、`unreadDone`、`waveSessionId`、`model`。
