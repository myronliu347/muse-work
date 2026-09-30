# Issue 工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地一级 Issue：UI/对话创建，一对规划/执行会话 + 结构化清单，规划 AI `dispatch` 调度执行，待审核后与人对话直到完成或取消。

**Architecture:** Server 用与 `sessionStore` 相同的内存 Map + JSON 原子写保存 Issue；REST 改状态；`dispatch` 复用 `SessionRunner.sendMessage` / `setOnTurnSettled` / `wrapSystemInject`。规划会话的 git worktree 由 desktop 现有 `createWorktree` 先建好，再把路径和 worktree 字段交给 `POST /issues/:id/planning-session`（server 不再实现第二套 git）。Webview 只加侧栏「待办事项」分组与新建/打开规划对话框，不恢复旧看板。

**Tech Stack:** Hono + vitest（`listenTestApp`）、现有 sessionRunner、内置 wave plugin（`packages/server/plugins/issue`）、webview React + zustand desktopStore、hostBridge WS。

**Spec:** [docs/superpowers/specs/2026-09-01-issue-design.md](../specs/2026-09-01-issue-design.md)

## Global Constraints

- 词汇与状态机以 `CONTEXT.md` 和 `docs/superpowers/specs/2026-09-01-issue-design.md` 为准
- 状态只有：`pending | planning | executing | review | completed | cancelled`；禁止 `rejected` / `reviewing` / 审核不通过
- `review` 下再 `dispatch` **保持** `review`
- 每 Issue 最多 1 个规划会话、1 个执行会话
- 对话创建 Issue **不**预填当前会话 workdir
- 完成不强制清单全 done；规划会话未建不能 dispatch
- 关 Issue 不删除会话；已完成/已取消不进侧栏 `issueGroups`
- 规划/普通会话挂 `issue` 插件；**执行会话不挂**（`session.agentName === resolveScenarioAgent("issue-exec")` 时跳过），避免执行 AI 自行关单
- `dispatch` 向执行会话发消息用 `source: "system-inject"`（`runTurn` 会自己 `wrapSystemInject`，调度器不要预先再包一层）
- 执行回合结束后注入规划会话的正文必须以 `来源：执行会话` 开头，规划 skill 将其视为执行回报而非用户发言
- `hub.broadcastAll({ type: "issue:changed" })`（`WsHub.broadcastAll` 吃 `WsEvent`，不要伪造 `sessionId`）
- 不用 SQLite；不用全局并发槽位
- 测试只断言外部行为；命令均在仓库根或对应 package 下用 pnpm

## File Structure

| 路径 | 职责 |
|---|---|
| `packages/server/src/services/issueStore.ts` | Issue 持久化、清单、状态迁移纯函数 |
| `packages/server/src/services/issueDispatch.ts` | 确保执行会话、`dispatch`、`onTurnSettled` 回写清单与注入规划会话 |
| `packages/server/src/routes/issues.ts` | `/issues` REST |
| `packages/server/src/app.ts` | 挂载 routes |
| `packages/server/src/services/appContext.ts` | `issueStore` + 绑定 `setOnTurnSettled` |
| `packages/server/src/services/agentConfig.ts` | 场景 `issue-plan` / `issue-exec` |
| `packages/server/src/routes/sessions.ts` | `grouped` 增加 `issueGroups`，recent 剔除 Issue 会话 |
| `packages/server/src/services/wsEvents.ts` | `issue:changed` |
| `packages/server/src/services/sessionRunner/agent.ts` | 规划/普通会话挂 `issue` 插件；issue-exec 不挂 |
| `packages/server/plugins/issue/` | skill + `scripts/issue.mjs` |
| `packages/webview/src/muse/apiClient.ts` | Issue HTTP 类型与方法 |
| `packages/webview/src/muse/hostBridge/*` | `issueGroups` + `issue:changed` 刷新树 |
| `packages/webview/src/types/index.ts` | `DesktopIssueGroup` |
| `packages/webview/src/components/session/SessionTree.tsx` | 「待办事项」section |
| `packages/webview/src/components/issue/NewIssueDialog.tsx` | 新建表单 |
| `packages/webview/src/components/issue/OpenPlanningDialog.tsx` | workdir + worktree 开关 |
| `packages/webview/src/components/settings/AgentManager.tsx` | 两行场景标签 |

---

### Task 1: IssueStore 持久化与状态辅助

**Files:**
- Create: `packages/server/src/services/issueStore.ts`
- Test: `packages/server/tests/issueStore.test.ts`

**Interfaces:**
- Consumes: `getMuseHomeDir` from `@muse-work/provider`；`home` 语义与 `createSessionStore` 相同
- Produces:

```ts
export type IssuePriority = "p0" | "p1" | "p2";
export type IssueStatus =
  | "pending"
  | "planning"
  | "executing"
  | "review"
  | "completed"
  | "cancelled";
export type ChecklistItemStatus = "pending" | "running" | "done";

export interface ChecklistItem {
  id: string;
  content: string;
  status: ChecklistItemStatus;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  priority: IssuePriority;
  tags: string[];
  status: IssueStatus;
  workdir?: string;
  worktreeEnabled?: boolean;
  baseBranch?: string;
  planningSessionId?: string;
  executionSessionId?: string;
  items: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
}

export function normalizeTags(tags: unknown): string[];
export function allItemsDone(items: ChecklistItem[]): boolean;
export function createIssueStore(options?: { home?: string }): IssueStore;

export interface IssueStore {
  create(input: {
    title: string;
    description?: string;
    priority?: IssuePriority;
    tags?: string[];
  }): Issue;
  get(id: string): Issue | undefined;
  listActive(): Issue[]; // 非 completed/cancelled，priority p0→p1→p2 再 updatedAt desc
  listAll(): Issue[];
  update(
    id: string,
    patch: Partial<Pick<Issue, "title" | "description" | "priority" | "tags">>,
  ): Issue | undefined;
  setPlanning(
    id: string,
    fields: {
      planningSessionId: string;
      workdir: string;
      worktreeEnabled: boolean;
      baseBranch?: string;
    },
  ): Issue | undefined; // 同时把 status 写成 planning（终态返回 undefined）
  setExecutionSessionId(id: string, executionSessionId: string): Issue | undefined;
  setItems(id: string, items: ChecklistItem[]): Issue | undefined;
  patchItem(
    id: string,
    itemId: string,
    patch: Partial<Pick<ChecklistItem, "content" | "status">>,
  ): Issue | undefined;
  complete(id: string): Issue | undefined; // cancelled 返回 undefined
  cancel(id: string): Issue | undefined;   // 已 completed 返回 undefined
  /** executing 且全部 done → review；已是 review 保持 review；终态不动 */
  maybeEnterReview(id: string): Issue | undefined;
  markExecuting(id: string): Issue | undefined; // pending/cancelled/completed 返回 undefined；review 保持 review
}
```

存储路径：`path.join(getMuseHomeDir(home), "db", "issues.json")` 索引 `{ version: 1, issues: Issue[] }`（全量字段可写索引，明细目录可与索引同内容——**本期索引即全量数组，目录 `db/issues/<id>/issue.json` 同步写一份**，方便以后拆明细）。原子写：`writeFileSync(tmp)` + `renameSync`。

- [ ] **Step 1: 写失败测试**

`packages/server/tests/issueStore.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIssueStore } from "../src/services/issueStore.js";

describe("issueStore", () => {
  it("persists create and reloads tags/priority", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({
      title: "修登录",
      tags: [" Auth ", "auth", ""],
      priority: "p0",
    });
    expect(issue.status).toBe("pending");
    expect(issue.tags).toEqual(["auth"]);
    expect(issue.priority).toBe("p0");
    const reloaded = createIssueStore({ home });
    expect(reloaded.get(issue.id)?.title).toBe("修登录");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("maybeEnterReview stays review after items bounce", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const issue = store.create({ title: "t" });
    store.setPlanning(issue.id, {
      planningSessionId: "p",
      workdir: "/tmp/a",
      worktreeEnabled: false,
    });
    store.markExecuting(issue.id);
    store.setItems(issue.id, [
      { id: "i1", content: "a", status: "done" },
    ]);
    expect(store.maybeEnterReview(issue.id)?.status).toBe("review");
    store.patchItem(issue.id, "i1", { status: "running" });
    expect(store.maybeEnterReview(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("complete rejects cancelled; cancel rejects completed", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-issue-"));
    const store = createIssueStore({ home });
    const a = store.create({ title: "a" });
    store.cancel(a.id);
    expect(store.complete(a.id)).toBeUndefined();
    const b = store.create({ title: "b" });
    store.complete(b.id);
    expect(store.cancel(b.id)).toBeUndefined();
    fs.rmSync(home, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server exec vitest run tests/issueStore.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 实现 `issueStore.ts`**

`normalizeTags`：`Array.isArray` 才处理；每项 `String(t).trim().toLowerCase()`，空串丢掉，`Set` 去重保序。`create` 无 title trim 则 `throw new Error("title required")`。`listActive` 过滤终态，排序 `p0=0,p1=1,p2=2` 再 `-updatedAt`。`create` 用 `crypto.randomUUID()`。`setPlanning`：终态 `undefined`；否则写入字段并把 `status` 设为 `planning`。`markExecuting`：`review` 原样返回 clone；已是 `executing` 原样返回；`planning` 改为 `executing`；否则 `undefined`。`maybeEnterReview`：终态返回 clone；若 `items.length>0 && allItemsDone` 且 status 为 `executing` 则设 `review`；若已是 `review` 返回 clone（即使 items 未全 done）。`complete`/`cancel` 改 `status` 并 `updatedAt=Date.now()`。

- [ ] **Step 4: 再跑测试**

Run: `pnpm -F @muse-work/server exec vitest run tests/issueStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/issueStore.ts packages/server/tests/issueStore.test.ts
git commit -m "$(cat <<'EOF'
feat(server): 新增 IssueStore 持久化与状态辅助

为 Issue 工作流提供磁盘存储、标签规范和待审核不回退的状态迁移。
EOF
)"
```

---

### Task 2: Issue REST（CRUD / complete / cancel）与 `issue:changed`

**Files:**
- Create: `packages/server/src/routes/issues.ts`
- Modify: `packages/server/src/app.ts`（`app.route("/", issuesRoutes)`）
- Modify: `packages/server/src/services/appContext.ts`（`issueStore: IssueStore`，`createIssueStore({ home })` 放进返回值）
- Modify: `packages/server/src/services/wsEvents.ts`（联合类型增加 `{ type: "issue:changed" }`）
- Test: `packages/server/tests/issues.routes.test.ts`

**Interfaces:**
- Consumes: Task 1 `IssueStore`；`c.get("ctx")` 的 `hub.broadcastAll`
- Produces: HTTP
  - `GET /issues` → `{ issues }`（active）
  - `GET /issues/:id` → `{ issue }` 或 404
  - `POST /issues` body `{ title, description?, priority?, tags? }` → 201 `{ issue }`
  - `PATCH /issues/:id` body 同 update patch → `{ issue }`；终态 409
  - `POST /issues/:id/complete` → `{ issue }`；cancelled 409
  - `POST /issues/:id/cancel` → `{ issue }`；completed 409
  - 写路径成功后 `ctx.hub.broadcastAll({ type: "issue:changed" })`

`WsEvent` 增加 `{ type: "issue:changed" }`。`broadcastAll` 签名是 `(event: WsEvent) => void`（见 `packages/server/src/services/wsHub.ts`）。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { closeTestApp, listenTestApp } from "./helpers.js";

describe("issues HTTP", () => {
  let server: Server | undefined;
  let home: string | undefined;
  afterEach(async () => {
    if (server) await closeTestApp(server, home);
    server = undefined;
    home = undefined;
  });

  it("POST /issues then GET list; cancel hides from list", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const created = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "修登录", tags: ["Auth"] }),
    });
    expect(created.status).toBe(201);
    const { issue } = await created.json();
    expect(issue.tags).toEqual(["auth"]);
    const list = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(list.issues.map((i: { id: string }) => i.id)).toContain(issue.id);
    const cancel = await fetch(`${app.baseUrl}/issues/${issue.id}/cancel`, {
      method: "POST",
    });
    expect(cancel.status).toBe(200);
    const list2 = await fetch(`${app.baseUrl}/issues`).then((r) => r.json());
    expect(list2.issues.map((i: { id: string }) => i.id)).not.toContain(issue.id);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/server exec vitest run tests/issues.routes.test.ts`
Expected: FAIL 404

- [ ] **Step 3: 实现路由并挂到 app / AppContext**

`issues.ts` 用 `new Hono<HonoEnv>()`；`PATCH` 若 `get` 不到 404；若 `status` 为 completed/cancelled 则 409 `{ error: "issue is terminal" }`。`complete`/`cancel` store 返回 `undefined` 时 409。

- [ ] **Step 4: 再跑测试**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/issues.ts packages/server/src/app.ts packages/server/src/services/appContext.ts packages/server/src/services/wsEvents.ts packages/server/tests/issues.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): 增加 Issue REST 创建、列表、完成与取消

让 UI 和插件能落库 Issue，变更通过 issue:changed 通知前端。
EOF
)"
```

---

### Task 3: Agent 场景 + 打开规划会话

**Files:**
- Modify: `packages/server/src/services/agentConfig.ts`（`AgentScenarioKey` 加 `"issue-plan" | "issue-exec"`；`defaultScenarios` 为 `{ session: "default", popo: "popo", "issue-plan": "plan", "issue-exec": "execute" }`）
- Modify: `packages/server/src/routes/issues.ts`（`POST /issues/:id/planning-session`）
- Modify: `packages/server/tests/agentConfig.test.ts`、`packages/server/tests/agents.routes.test.ts`（默认 scenarios 断言补两键）
- Modify: `packages/webview/src/muse/apiClient.ts`（`MuseAgentScenarios` 的 Record 键同步）
- Modify: `packages/webview/src/components/settings/AgentManager.tsx`（`SCENARIO_LABELS` 增加 `{ key: "issue-plan", label: "Issue 规划" }`、`{ key: "issue-exec", label: "Issue 执行" }`；`saveScenarios` 的 `scenarios` 对象带上这两键）
- Modify: 对应 webview agent 测试里的 scenarios mock 对象
- Test: 扩 `packages/server/tests/issues.routes.test.ts`

**Interfaces:**
- Consumes: `resolveScenarioAgent`、`resolveAgent`、`buildSystemPrompt`、`resolvePermission`、`ctx.store.create`（与 `POST /sessions` 相同字段）
- Produces: `POST /issues/:id/planning-session` body:

```ts
{
  workdir: string;
  worktreeEnabled: boolean;
  baseBranch?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  worktreeRepoRoot?: string;
}
```

行为：Issue 不存在 404；终态 409；已有 `planningSessionId` 则 **幂等返回** `{ sessionId, workdir }`（不新建会话）。否则 `workdir` 必填 trim，否则 400。用 `issue-plan` 解析 agent，`store.create` 的 `workdir`：若 `worktreeEnabled && worktreeName` 则用客户端传来的 worktree 路径（body.workdir 必须已是 worktree 目录）；`title` 用 Issue.title。然后 `issueStore.setPlanning`。成功 200 `{ sessionId, workdir }`。

**Worktree 不在 server 创建**：UI 若勾选 worktree，先走 desktop `desktopCreateWorktree`，把返回的 `path/name/branch/baseBranch/repoRoot` 填进该 POST。非 git 时 `worktreeEnabled: false`，`workdir` 为所选目录。

- [ ] **Step 1: 写失败测试**（issues.routes）

```ts
  it("POST planning-session creates one planning session and is idempotent", async () => {
    const app = await listenTestApp();
    server = app.server;
    home = app.home;
    const { issue } = await fetch(`${app.baseUrl}/issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "设计评审" }),
    }).then((r) => r.json());
    const res = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/proj", worktreeEnabled: false }),
    });
    expect(res.status).toBe(200);
    const first = await res.json();
    const session = app.ctx.store.get(first.sessionId);
    expect(session?.agentName).toBe("plan");
    expect(app.ctx.issueStore.get(issue.id)?.status).toBe("planning");
    const second = await fetch(`${app.baseUrl}/issues/${issue.id}/planning-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workdir: "/tmp/other", worktreeEnabled: false }),
    }).then((r) => r.json());
    expect(second.sessionId).toBe(first.sessionId);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Expected: FAIL 404 on planning-session

- [ ] **Step 3: 改 agentConfig + 实现 POST + 更新默认 scenarios 测试**

`packages/server/src/services/agentConfig.ts`：

```ts
export type AgentScenarioKey = "session" | "popo" | "issue-plan" | "issue-exec";
export const AGENT_SCENARIO_KEYS: AgentScenarioKey[] = [
  "session",
  "popo",
  "issue-plan",
  "issue-exec",
];
export function defaultScenarios(): Record<AgentScenarioKey, string> {
  return {
    session: "default",
    popo: "popo",
    "issue-plan": "plan",
    "issue-exec": "execute",
  };
}
```

`agentConfig.test.ts` 的 `ensureDefaultConfigs` 断言改成：

```ts
expect(scenarios.scenarios).toEqual({
  session: "default",
  popo: "popo",
  "issue-plan": "plan",
  "issue-exec": "execute",
});
```

已存在的用户 `agent-scenarios.json` 不必迁移：`resolveScenarioAgent` 对缺键走 `defaultScenarios()`。

`POST /sessions` 创建逻辑本期允许在 `issues.ts` 内联复制（约 40 行），禁止新 git 工具文件。

- [ ] **Step 4: 跑 `issues.routes.test.ts` 与 `agentConfig.test.ts`**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: 打开 Issue 规划会话并增加 issue-plan/issue-exec 场景

首次打开规划时绑定 workdir，复用内置 plan/execute agent。
EOF
)"
```

---

### Task 4: 清单 API、dispatch、执行会话、turn 回写

**Files:**
- Create: `packages/server/src/services/issueDispatch.ts`
- Modify: `packages/server/src/routes/issues.ts`
  - `PUT /issues/:id/items` body `{ items: { id?: string; content: string; status?: ChecklistItemStatus }[] }`
  - `POST /issues/:id/dispatch` body `{ itemId: string; prompt?: string }`
- Modify: `packages/server/src/services/appContext.ts`：`createIssueDispatcher({ issues, sessions, runner, hub })`，`runner.setOnTurnSettled(dispatcher.handleTurnSettled)`
- Test: `packages/server/tests/issueDispatch.test.ts` 与扩 `issues.routes.test.ts`

**Interfaces:**
- Consumes: `IssueStore`、`SessionStore.create/get`、`SessionRunner.sendMessage`、`wrapSystemInject` from `./sessionRunner/index.js`、`resolveScenarioAgent("issue-exec")`
- Produces:

```ts
export function createIssueDispatcher(opts: {
  issues: IssueStore;
  sessions: SessionStore;
  runner: SessionRunner;
  hub: WsHub;
}): {
  dispatch(issueId: string, itemId: string, prompt?: string): Promise<{ executionSessionId: string }>;
  handleTurnSettled(sessionId: string, result: { ok: boolean; error?: string }): void;
};
```

内存 `Map<executionSessionId, { issueId: string; itemId: string }>` 记录 inflight。`dispatch`：

1. Issue 缺失 throw 404；`completed|cancelled` throw 409；无 `planningSessionId` throw 409 `"planning session required"`
2. item 不存在 404
3. 无 `executionSessionId`：按规划会话拷贝 `workdir/worktreeName/worktreeBranch/baseBranch/worktreeRepoRoot`，`permissionMode: "bypassPermissions"`，agent `issue-exec`，title `` `${issue.title} · 执行` ``，`setExecutionSessionId`
4. `status==="planning"` 时 `markExecuting`；`review` 不改状态
5. `patchItem(..., { status: "running" })`
6. `inflight.set(execId, { issueId, itemId })`
7. `runner.sendMessage(execId, execPrompt, undefined, "system-inject")` —— `execPrompt` 含清单项 `content` 与可选 `prompt`；不要先 `wrapSystemInject`（`runTurn` 见 `source` 会再包一次）
8. `hub.broadcastAll({ type: "issue:changed" })`
9. 返回 `{ executionSessionId }`

`handleTurnSettled`：查 inflight；`patchItem` 为 `done`（ok）或 `pending`（!ok）；delete inflight；`maybeEnterReview`；对 `planningSessionId` 调用 `runner.sendMessage(planningId, report, undefined, "system-inject")`。`report` 必须能让规划模型识别来源：

```ts
export function formatExecTurnReport(input: {
  itemContent: string;
  ok: boolean;
  error?: string;
}): string {
  const line = input.ok
    ? `清单项「${input.itemContent}」已完成。`
    : `清单项「${input.itemContent}」失败${input.error ? `：${input.error}` : "。"}`;
  return `来源：执行会话\n${line}`;
}
```

规划 skill（Task 6）写明：正文以 `来源：执行会话` 开头的系统注入是执行回合回报，不是用户新需求。然后 `hub.broadcastAll({ type: "issue:changed" })`。

`PUT /issues/:id/items`：缺 `id` 的项用 `crypto.randomUUID()`；`status` 缺省 `pending`。`POST /dispatch`：无规划会话 409 `{ error: "planning session required" }`；终态 409；item 不存在 404。

- [ ] **Step 1: 写失败测试**

```ts
// packages/server/tests/issueDispatch.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIssueStore } from "../src/services/issueStore.js";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createIssueDispatcher } from "../src/services/issueDispatch.js";

describe("issueDispatch", () => {
  it("creates exec session; all done enters review; second dispatch keeps review", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-dispatch-"));
    const issues = createIssueStore({ home });
    const sessions = createSessionStore({ home });
    const sends: Array<{ id: string; content: string; source?: string }> = [];
    const runner = {
      sendMessage: async (
        id: string,
        content: string,
        _images?: unknown,
        source?: "user" | "system-inject",
      ) => {
        sends.push({ id, content, source });
        return { accepted: true as const };
      },
    };
    const hub = { broadcastAll: () => {} };
    const dispatcher = createIssueDispatcher({
      issues,
      sessions,
      runner: runner as never,
      hub: hub as never,
    });
    const issue = issues.create({ title: "修登录" });
    const planning = sessions.create({
      workdir: "/tmp/proj",
      model: "m",
      title: "修登录",
      agentName: "plan",
    });
    issues.setPlanning(issue.id, {
      planningSessionId: planning.id,
      workdir: "/tmp/proj",
      worktreeEnabled: false,
    });
    issues.setItems(issue.id, [{ id: "i1", content: "改登录", status: "pending" }]);

    const first = await dispatcher.dispatch(issue.id, "i1");
    expect(issues.get(issue.id)?.status).toBe("executing");
    expect(sends[0]?.id).toBe(first.executionSessionId);
    expect(sends[0]?.source).toBe("system-inject");
    expect(sends[0]?.content).toContain("改登录");

    dispatcher.handleTurnSettled(first.executionSessionId, { ok: true });
    expect(issues.get(issue.id)?.status).toBe("review");
    const report = sends.find((s) => s.id === planning.id);
    expect(report?.source).toBe("system-inject");
    expect(report?.content).toContain("来源：执行会话");
    expect(report?.content).toContain("改登录");

    issues.patchItem(issue.id, "i1", { status: "pending" });
    await dispatcher.dispatch(issue.id, "i1", "再改一下");
    dispatcher.handleTurnSettled(first.executionSessionId, { ok: true });
    expect(issues.get(issue.id)?.status).toBe("review");
    fs.rmSync(home, { recursive: true, force: true });
  });
});
```

`issues.routes.test.ts` 追加：先 `planning-session`，再 `PUT /issues/:id/items` `{ items: [{ content: "改登录" }] }`，再 `POST /issues/:id/dispatch` `{ itemId }`，期望 200 且 body 有 `executionSessionId`。测试用 `createAppContext({ home, createAgent: async () => ({ sendMessage: async () => {}, dispose: async () => {} }) })` 避免真跑模型。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 dispatcher 与路由；appContext 接线**

`createAppContext` 在 runner 创建后：

```ts
const issues = createIssueStore({ home });
const dispatcher = createIssueDispatcher({
  issues,
  sessions: sessions.store,
  runner: sessions.runner,
  hub: sessions.hub,
});
sessions.runner.setOnTurnSettled((sessionId, result) => {
  dispatcher.handleTurnSettled(sessionId, result);
});
return { ...sessions, home, registry, issueStore: issues, issueDispatcher: dispatcher };
```

`AppContext` 增加 `issueDispatcher`（测试可调用）。

- [ ] **Step 4: 跑测试**

Expected: PASS（dispatch 的 sendMessage 在 listenTestApp 默认 createAgent 可能空转；routes 测试若会真跑 agent，改为注入 `createAgent` no-op，与 `sessionRunner.test.ts` 相同）

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): Issue dispatch 复用单一执行会话并在清单完成后进入待审核

规划侧调度执行回合，回写清单；待审核下再执行不改变 Issue 状态。
EOF
)"
```

---

### Task 5: `GET /sessions?grouped=1` 的 `issueGroups`

**Files:**
- Modify: `packages/server/src/routes/sessions.ts` 的 grouped 分支
- Modify: `packages/server/tests/sessions.routes.test.ts`

**Interfaces:**
- Produces:

```ts
issueGroups: Array<{
  issueId: string;
  title: string;
  priority: string;
  status: string;
  items: ChecklistItem[];
  sessions: Session[];
}>
```

只包含 `listActive()`。每个 group 收集 `planningSessionId`、`executionSessionId` 在 `ctx.store.get` 中存在的会话（**含尚未 started 的**，否则刚创建的规划会话会被 `listGrouped` 的 `isStartedSession` 滤掉——此处用 `store.get` 直取）。`recent` 从 `listGrouped().recent` 再 filter 掉这些 session id。无会话的 pending Issue 仍出现在 `issueGroups`（`sessions: []`），以便侧栏显示空组 + 打开规划。

- [ ] **Step 1: 写失败测试**

```ts
it("grouped exposes issueGroups and strips those sessions from recent", async () => {
  const app = await listenTestApp();
  // create issue + planning-session
  // also create a normal session
  const grouped = await fetch(`${app.baseUrl}/sessions?grouped=1`).then((r) => r.json());
  expect(grouped.issueGroups).toHaveLength(1);
  expect(grouped.recent.map((s: { id: string }) => s.id)).not.toContain(
    grouped.issueGroups[0].sessions[0].id,
  );
});
```

- [ ] **Step 2–4: 实现并跑 `sessions.routes.test.ts`**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): 会话分组返回 Issue 侧栏数据

规划/执行会话从 recent 剔除，待办事项按 Issue 折叠展示。
EOF
)"
```

---

### Task 6: 内置 issue 插件（对话创建与调度）

**Files:**
- Create: `packages/server/plugins/issue/.muse-plugin/plugin.json`
- Create: `packages/server/plugins/issue/skills/issue-management/SKILL.md`
- Create: `packages/server/plugins/issue/skills/issue-management/scripts/issue.mjs`
- Modify: `packages/server/src/services/sessionRunner/agent.ts` `enabledPluginDirs(session)`：settings 的 superpowers/mattpocock 之后，若 `session?.agentName !== resolveScenarioAgent("issue-exec", home)`，再 `pluginDirIfPresent("issue")`
- Test: `packages/server/tests/sessionRunner.test.ts` 新增用例（现有文件没有「passes local plugins」断言，不要改旧用例语义）

**Interfaces:**
- `issue.mjs` CLI：`process.argv[2]` 为子命令。Base URL：`process.env.MUSE_SERVER_URL` 或读 `path.join(getMuseHomeDir(), "server-url")` 或默认 `http://127.0.0.1:8787`。
  - `create --title T [--description D] [--priority p0|p1|p2] [--tags a,b]` → POST `/issues`
  - `update --id ID [--title] [--description] [--priority] [--tags]`
  - `items --id ID --set-json '[{ "content": "..." }]'` → PUT `/issues/:id/items`（脚本为缺 id 的项生成 uuid）
  - `dispatch --id ID --item ITEM_ID [--prompt P]`
  - `complete --id ID` / `cancel --id ID`
- stdout 打印 JSON；非 2xx `process.exit(1)` 并 stderr 打 body。
- SKILL.md 必须写清：用户说创建 issue 才 create；确认方案后维护清单再 dispatch；待审核可选用子代理做 E2E/code review（非强制）；用户说关掉/完成则 complete。执行会话根本看不到此 skill（Task 6 挂载规则）。收到正文以 `来源：执行会话` 开头的系统注入时，当作执行回合回报（成功/失败），不要当成用户又提了新需求；据此决定继续 dispatch 或向用户汇报。

- [ ] **Step 1: 写失败测试**（sessionRunner）

```ts
it("mounts issue plugin on default sessions but not issue-exec", async () => {
  // home + saveProvidersConfig + mock provider 同文件其它用例
  const seen: Array<{ agentName?: string; plugins?: unknown }> = [];
  const runner = createSessionRunner({
    store, hub, registry, home,
    createAgent: async (options) => {
      seen.push({ plugins: options.plugins });
      return { sendMessage: async () => {}, dispose: async () => {} };
    },
  });
  const normal = store.create({ workdir: home, model: "gpt-4.1", agentName: "default" });
  await runner.sendMessage(normal.id, "hi");
  await expect.poll(() => seen.length).toBe(1);
  expect(JSON.stringify(seen[0].plugins)).toContain("plugins/issue");

  const exec = store.create({ workdir: home, model: "gpt-4.1", agentName: "execute" });
  await runner.sendMessage(exec.id, "hi");
  await expect.poll(() => seen.length).toBe(2);
  expect(JSON.stringify(seen[1].plugins ?? [])).not.toContain("plugins/issue");
});
```

另写 `packages/server/tests/issuePluginScript.test.ts`：`listenTestApp` 后 `execFileSync("node", [script, "create", "--title", "x"], { env: { ...process.env, MUSE_SERVER_URL: app.baseUrl } })`，断言 stdout JSON 含 title。

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 加 plugin 目录 + agent.ts 挂载 + issue.mjs**
- [ ] **Step 4: 跑 sessionRunner 新用例与 issuePluginScript.test.ts**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): 内置 issue 插件并挂到规划/普通会话

对话里可创建 Issue、改清单并 dispatch；执行会话不挂此插件。
EOF
)"
```

---

### Task 7: webview API、hostBridge、`issue:changed`

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts`
- Modify: `packages/webview/src/types/index.ts`（`DesktopIssueGroup`，`DesktopHostProps.issueGroups`）
- Modify: `packages/webview/src/muse/hostBridge/ctx.ts`、`session.ts`、`index.ts`
- Modify: `packages/webview/src/stores/desktopStore.ts`、`DesktopApp.tsx`
- Modify: `packages/webview/src/muse/wsClient.ts`（`issue:changed`）
- Modify: `packages/webview/src/muse/messageRouter.ts`（收到 `issue:changed` → `desktopRefreshSessionTree`）
- Test: `packages/webview/tests/apiClient.test.ts`、`packages/webview/tests/muse/hostBridge.test.ts`

**Interfaces:**
- `MuseIssue` 与 server Issue 字段对齐
- `MuseSessionsGrouped.issueGroups?: DesktopIssueGroup[]`（sessions 为 `MuseSession[]`）
- apiClient: `listIssues`、`createIssue`、`updateIssue`、`completeIssue`、`cancelIssue`、`openPlanningSession`、`setIssueItems`、`dispatchIssue`
- hostBridge `applyGrouped` 存 `ctx.issueGroups`；`emitSessionTree` 带 `issueGroups`（`toEntry`）；`treeById` 扫 issue 组会话；`issue:changed` 与 `todo:changed` 删除后的空位相同：所有 pane `postToWebview({ command: "issue:changed" })` 后 refreshTree（messageRouter 里 `vscode.postMessage({ command: "desktopRefreshSessionTree" })`）

- [ ] **Step 1: apiClient 测试 list/create 路径**
- [ ] **Step 2: hostBridge 测试 desktopReady 带 issueGroups**
- [ ] **Step 3: 实现到绿**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(webview): Issue API 与会话树同步 issueGroups

WS issue:changed 时刷新侧栏，避免规划/执行会话漏出到工作空间。
EOF
)"
```

---

### Task 8: 侧栏「待办事项」+ 新建 Issue

**Files:**
- Create: `packages/webview/src/components/issue/NewIssueDialog.tsx`
- Modify: `packages/webview/src/components/session/SessionTree.tsx`（`SectionId` 加 `"issues"`；props `issueGroups`；`renderIssuesSection` 插在 pin 与 tasks 之间）
- Modify: `packages/webview/src/components/desktop/DesktopSidebar.tsx` 透传
- Modify: `packages/webview/src/styles/DesktopApp.css`（优先级徽标 `.issue-sidebar-priority-p0|p1|p2`，复用原 todo 徽标数值即可）
- Test: `packages/webview/tests/components/DesktopSidebar.sessions.test.tsx`、`DesktopApp.test.tsx`

**Interfaces:**
- `DesktopIssueGroup`：`issueId, title, priority, status, items, sessions: DesktopSessionEntry[]`
- 分组行：标题、`priority.toUpperCase()`、会话数；展开后只读清单（`done` 用 codicon-check，其它空框）再列会话
- section 头右侧「+」→ `onNewIssue()`；对话框字段：title 必填、description textarea、priority 三选一默认 p1、tags 逗号分隔。提交 `api.createIssue` 后 `onIssuesChanged()` → `desktopRefreshSessionTree`
- 无会话的 Issue 组仍渲染，空态文案「打开规划会话」按钮 → `onOpenPlanning(issueId)`
- Issue 会话 `hideActions: true`（不允许从待办分组置顶/删除，与旧 todo 组相同）

- [ ] **Step 1: 侧栏测试「待办事项」section 与优先级**
- [ ] **Step 2: 实现 UI**
- [ ] **Step 3: 跑 DesktopSidebar / DesktopApp 测试**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(webview): 侧栏待办事项按 Issue 分组并支持新建

分组展示规划/执行会话与只读清单，新建后仍为待规划。
EOF
)"
```

---

### Task 9: 打开规划（workdir + worktree）与完成/取消

**Files:**
- Create: `packages/webview/src/components/issue/OpenPlanningDialog.tsx`
- Modify: `ChatApp.tsx` / `DesktopSidebar`：传入 `popoApi`、`onOpenPlanning`、`onCompleteIssue`、`onCancelIssue`
- 打开规划流程（必须按此顺序，禁止 server 调 git）：
  1. 对话框：选目录（`desktopPickDirectory` + `desktopPickDirectoryResult`，超时 15s）、checkbox「worktree 模式」、可选 baseBranch 文本
  2. 若 worktree：`postToHost({ command: "desktopCreateWorktree", workdir, baseBranch, requestId })`，等 `desktopWorktreeCreated`；失败展示 error
  3. `api.openPlanningSession(issueId, { workdir: path, worktreeEnabled, baseBranch, worktreeName, worktreeBranch, worktreeRepoRoot })`
  4. `host.onSelectSession(workdir, sessionId)` + refresh 树
- 分组行更多菜单：完成、取消（`ConfirmDialog`）。调用 `completeIssue` / `cancelIssue` 后 refresh
- Test: `todoBoard` 已删；在 `DesktopSidebar.sessions.test.tsx` 测完成按钮出现；OpenPlanning 可用组件测试 mock `pickDirectory`

**Interfaces:**
- `MuseApiClient.openPlanningSession(id, body)` → `{ sessionId, workdir }`

- [ ] **Step 1: 写 OpenPlanningDialog 测试（点确认会 POST 且 worktree 关时不发 desktopCreateWorktree）**
- [ ] **Step 2: 实现对话框与接线**
- [ ] **Step 3: 跑 webview 相关测试**
- [ ] **Step 4: 跑 `pnpm -F @muse-work/server test` 与 `pnpm -F @muse-work/webview exec vitest run tests/components/DesktopSidebar.sessions.test.tsx tests/muse/hostBridge.test.ts tests/apiClient.test.ts`**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(webview): Issue 打开规划时选择目录与 worktree，并支持完成取消

规划环境在动手前绑定；关单不删除会话，仅从待办分组消失。
EOF
)"
```

---

## Self-review vs spec

| Spec 要求 | Task |
|---|---|
| UI/对话创建 | 8 / 6 |
| 优先级+标签 | 1–2, 8 |
| 待规划→规划中（选 workdir+worktree） | 3, 9 |
| 1 规划 + 1 执行 | 3–4 |
| 结构化清单 | 1, 4, 8 |
| dispatch 继承配置 | 4 |
| 全 done → review | 4 |
| review 再 dispatch 仍 review | 4 |
| 无审核不通过 | 1, 4 |
| 对话+UI 完成/取消 | 2, 6, 9 |
| 侧栏待办事项 | 5, 7, 8 |
| 终态不进分组、不删会话 | 5, 9 |
| 对话创建不预填 workdir | 6 skill + 2 POST |
| 可选 E2E/review 子代理 | 6 SKILL.md 文案 |
| 执行会话无 complete/cancel | 6 不挂 issue 插件 |
| dispatch 系统/规划来源 | 4 `wrapSystemInject` |
| worktree 复用 desktop | 9 |
| plugin 脚本打 HTTP | 6 `issuePluginScript.test.ts` |
| 无旧看板 / 无并发 3 | 未列入任务 |

类型名全程 `Issue` / `ChecklistItem` / `issueGroups` / `issue:changed`。`createIssueDispatcher` 参数名始终是 `issues` / `sessions` / `runner` / `hub`。
