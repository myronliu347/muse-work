# 自动化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地本机 Automation：独立页面编辑规则（周期/间隔/单次 + Issue hook），cron/`once`/Issue 触发后用隐藏 session 无人值守跑 Agent，skill 可创建与启停。

**Architecture:** `automationStore` 用与 Issue 相同的内存 Map + JSON 原子写。`automationRuntime` 负责 enqueue（并发跳过）、分钟 tick（cron + once）、Issue subscribe、创建 `origin: "automation"` session 并 `sendMessage`。REST `/automations*`；WS `automation:changed`。Webview 侧栏只加「自动化」菜单，主栏是列表页 + Cursor 式编辑器，不是会话树分组。

**Tech Stack:** Hono + vitest（`listenTestApp`）、现有 `sessionStore` / `sessionRunner`、内置 wave plugin、webview React。

**Spec:** [docs/superpowers/specs/2026-09-16-automation-design.md](../specs/2026-09-16-automation-design.md)  
**原型:** [docs/superpowers/prototypes/2026-09-16-automation-prototype.html](../prototypes/2026-09-16-automation-prototype.html)

## Global Constraints

- 不走 Issue 状态机；不把运行混进日常会话树
- 存储：`~/.muse-work/db/automations.json` + `automation-runs.json`；不用 SQLite
- `hub.broadcastAll({ type: "automation:changed" })`（与 `issue:changed` 一样不要伪造 `sessionId`）
- 权限档 v1 仅 `workspace`：`bypassPermissions` + `disallowedTools` 含 `Workflow`
- 自动化 session **不挂** `automation` 与 `issue` 插件
- 停用后 cron/issue/`once` 不 enqueue；`POST .../run` 403 `disabled`
- 同规则已有 `running` → `skipped`/`rule_running`；全局 `running` ≥ 2 → `skipped`/`global_concurrency`
- 错过的 cron/`once` **不补跑**
- UI **不出现 cron 文本框**；周期/间隔编译成 cron；skill 可 `--cron`
- 编辑器允许未完成草稿：`enabled: false` 时可空 `name`/`prompt`/`workdir`/`triggers`；`enable` 与 `run` 在缺 prompt、workdir 或 triggers 时 400
- 测试只断言外部行为；命令在仓库根 `pnpm -F @muse-work/server test` / `pnpm -F @muse-work/webview test`
- 实现对照原型交互，不要发明弹窗式「名称+cron 字符串」创建表单

## File Structure

| 路径 | 职责 |
|---|---|
| `packages/server/src/services/automationStore.ts` | 规则 + 运行持久化、enable/disable、裁剪 100 条 |
| `packages/server/src/services/scheduleCompile.ts` | UI 周期/间隔 → cron；cron 反解；`cronMatchesLocal(expr, date)` |
| `packages/server/src/services/automationRuntime.ts` | enqueue、分钟 tick、Issue hook、RunExecutor、启动时 running→failed |
| `packages/server/src/routes/automations.ts` | `/automations` REST |
| `packages/server/src/services/issueStore.ts` | `subscribe` + review 首次进入才 emit |
| `packages/server/src/services/sessionStore.ts` | `origin`；`listGrouped` 排除 automation |
| `packages/server/src/routes/sessions.ts` | GET list 排除 automation；GET by id 仍返回 |
| `packages/server/src/services/sessionRunner/agent.ts` | origin/automation 不挂 issue+automation 插件 |
| `packages/server/src/services/wsEvents.ts` | `automation:changed` |
| `packages/server/src/services/appContext.ts` / `app.ts` | 接线 |
| `packages/server/plugins/automation/` | skill + `automation.mjs` |
| `packages/webview/src/muse/apiClient.ts` | HTTP 类型与方法 |
| `packages/webview/src/components/automation/*` | 列表页、编辑器、transcript 抽屉 |
| `packages/webview/src/components/desktop/DesktopSidebar.tsx` | 「自动化」菜单项 |
| `packages/webview/src/components/ChatApp.tsx` | `MainView` 增加 `automations` |
| `CONTEXT.md` | 补 Automation 词汇 |

---

### Task 1: AutomationStore

**Files:**
- Create: `packages/server/src/services/automationStore.ts`
- Test: `packages/server/tests/automationStore.test.ts`

**Interfaces:**
- Consumes: `getMuseHomeDir` from `@muse-work/provider`；`home` 语义与 `createIssueStore` 相同
- Produces:

```ts
export type AutomationPermission = "workspace";
export type AutomationRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "skipped";
export type SkipReason = "rule_running" | "global_concurrency";

export type AutomationTrigger =
  | { type: "cron"; expr: string }
  | { type: "once"; at: number; firedAt?: number }
  | {
      type: "issue";
      events: Array<"created" | "review" | "completed" | "cancelled">;
      tags?: string[];
      priority?: "p0" | "p1" | "p2";
    };

export interface Automation {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  prompt: string;
  workdir: string;
  agentName?: string;
  model?: string;
  permission: AutomationPermission;
  triggers: AutomationTrigger[];
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  sessionId?: string;
  status: AutomationRunStatus;
  trigger: {
    type: "cron" | "once" | "issue" | "manual";
    firedAt: number;
    issue?: {
      id: string;
      title: string;
      status: string;
      priority: string;
      tags: string[];
    };
  };
  skipReason?: SkipReason;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export function createAutomationStore(options?: { home?: string }): {
  create(input: Partial<Automation> & { triggers?: AutomationTrigger[] }): Automation;
  get(id: string): Automation | undefined;
  list(): Automation[];
  update(id: string, patch: Partial<Omit<Automation, "id" | "createdAt">>): Automation | undefined;
  setEnabled(id: string, enabled: boolean): Automation | undefined;
  remove(id: string): boolean;
  addRun(run: AutomationRun): AutomationRun;
  listRuns(automationId: string): AutomationRun[];
  getRun(runId: string): AutomationRun | undefined;
  patchRun(runId: string, patch: Partial<AutomationRun>): AutomationRun | undefined;
  failStaleRunning(error: string): void;
  countRunning(): number;
  hasRunning(automationId: string): boolean;
};
```

`create` 默认 `enabled: false`、`permission: "workspace"`、`name/prompt/workdir: ""`、`triggers: []`。原子写 JSON。`addRun` 后按 `automationId` 只留最新 100 条。

- [ ] **Step 1: Write the failing test**

```ts
it("persists create/disable/enable and prunes runs to 100", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-auto-"));
  const store = createAutomationStore({ home });
  const a = store.create({ name: "巡检", prompt: "查 changelog", workdir: "/tmp/p",
    triggers: [{ type: "cron", expr: "0 9 * * 1-5" }], enabled: true });
  expect(a.enabled).toBe(true);
  expect(store.setEnabled(a.id, false)?.enabled).toBe(false);
  expect(store.setEnabled(a.id, false)?.enabled).toBe(false); // idempotent
  for (let i = 0; i < 101; i++) {
    store.addRun({
      id: `r${i}`, automationId: a.id, status: "skipped",
      trigger: { type: "cron", firedAt: i }, skipReason: "rule_running", startedAt: i,
    });
  }
  expect(store.listRuns(a.id)).toHaveLength(100);
  const store2 = createAutomationStore({ home });
  expect(store2.get(a.id)?.enabled).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/server exec vitest run tests/automationStore.test.ts`

Expected: FAIL module not found

- [ ] **Step 3: Implement `createAutomationStore`**（对齐 `issueStore` 的 `writeJsonAtomic` 写法：先写 tmp 再 rename）

- [ ] **Step 4: Re-run tests — PASS**

- [ ] **Step 5: Commit** `feat(server): add automation store`

---

### Task 2: 周期编译与 cron 匹配

**Files:**
- Create: `packages/server/src/services/scheduleCompile.ts`
- Test: `packages/server/tests/scheduleCompile.test.ts`

**Interfaces:**
- Produces:

```ts
export type ScheduleUi =
  | { mode: "cycle"; cycle: "daily" | "weekday" | "0" | "1" | "2" | "3" | "4" | "5" | "6"; time: string }
  | { mode: "interval"; every: number; unit: "h" | "m" }
  | { mode: "once"; at: number };

export function compileSchedule(ui: ScheduleUi): AutomationTrigger;
export function decodeCron(expr: string): Extract<ScheduleUi, { mode: "cycle" | "interval" }> | null;
export function cronMatchesLocal(expr: string, at: Date): boolean;
```

`time` 为 `HH:mm`。`cycle daily` → `M H * * *`；`weekday` → `M H * * 1-5`；数字 → `M H * * D`。interval 小时仅允许 `1,2,3,4,6,8,12` → `0 */N * * *`；分钟仅 `1,5,10,15,30` → `*/N * * * *`。其它 抛错（routes 转 400）。`cronMatchesLocal` 只比本地时区的分/时/日/月/周，不支持 `L`/`#`。

- [ ] **Step 1: Failing tests** — `compileSchedule` 工作日 09:00 → `0 9 * * 1-5`；`cronMatchesLocal("0 9 * * 1-5", date)` 在周一 09:00 为 true、09:01 为 false；不可解 cron `decodeCron` 返回 null

- [ ] **Step 2–4:** 实现并跑 `vitest run tests/scheduleCompile.test.ts` — PASS

- [ ] **Step 5: Commit** `feat(server): compile schedule UI to cron`

---

### Task 3: REST CRUD / enable / disable（还不跑 Agent）

**Files:**
- Create: `packages/server/src/routes/automations.ts`
- Modify: `packages/server/src/app.ts` 挂载
- Modify: `packages/server/src/services/appContext.ts` 放入 `automationStore`
- Modify: `packages/server/src/services/wsEvents.ts` 增加 `{ type: "automation:changed" }`
- Test: `packages/server/tests/automations.routes.test.ts`

**Interfaces:**
- `POST /automations` body 可含 `schedule` UI 对象（服务端 `compileSchedule`）或已编译 `triggers`
- enable：缺 prompt 或 workdir 或 triggers → 400 `{ error: "incomplete" }`
- disable/enable 幂等 200 `{ automation }`
- 每次写成功 `ctx.hub.broadcastAll({ type: "automation:changed" })`

- [ ] **Step 1: Failing HTTP tests**（`listenTestApp`）

```ts
it("create draft, reject enable until complete, disable is idempotent", async () => {
  const app = await listenTestApp();
  const created = await fetch(`${app.baseUrl}/automations`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  expect(created.status).toBe(201);
  const { automation } = await created.json();
  expect(automation.enabled).toBe(false);
  const en = await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" });
  expect(en.status).toBe(400);
  await fetch(`${app.baseUrl}/automations/${automation.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "巡检", prompt: "x", workdir: app.home,
      schedule: { mode: "cycle", cycle: "daily", time: "09:00" },
    }),
  });
  expect((await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" })).status).toBe(200);
  expect((await fetch(`${app.baseUrl}/automations/${automation.id}/enable`, { method: "POST" })).status).toBe(200);
});
```

非法 interval `every: 7, unit: "h"` → PATCH 400。

- [ ] **Step 2–4:** 实现 routes + appContext + 跑测试 PASS

- [ ] **Step 5: Commit** `feat(server): automations REST crud and enable`

---

### Task 4: enqueue 并发 + 分钟 tick（cron / once）

**Files:**
- Create: `packages/server/src/services/automationRuntime.ts`
- Test: `packages/server/tests/automationRuntime.test.ts`
- Modify: `appContext.ts` 启动 runtime；`createAppContext` options 增加 `now?: () => Date` 仅测试用

**Interfaces:**

```ts
export function createAutomationRuntime(options: {
  store: ReturnType<typeof createAutomationStore>;
  hub: WsHub;
  sessions: SessionStore;
  runner: SessionRunner;
  home: string;
  now?: () => Date;
  startSession?: (args: { automation: Automation; run: AutomationRun }) => Promise<string>;
}): {
  enqueue(automationId: string, trigger: AutomationRun["trigger"]): AutomationRun | undefined;
  tick(): void;
  stop(): void;
};
```

`enqueue`：disabled → `undefined` 且不写 run；`hasRunning` → skipped；`countRunning() >= 2` → skipped；否则 running 并调用 `startSession`（本 task 可用 fake：返回 `"sess-1"` 并 `patchRun({ sessionId })`）。`tick`：对 enabled 规则，每个 `cron` 若 `cronMatchesLocal(expr, now())` 则 enqueue type cron；每个 `once` 若 `at <= now && !firedAt` 则 enqueue type once 并 `update` 该 trigger `firedAt`。同一分钟同一 expr 只 enqueue 一次（runtime 记 `lastTickMinute` 字符串 `YYYY-MM-DDTHH:mm`）。`start()` 里 `setInterval(tick, 15_000)`；`failStaleRunning("进程退出")` 在 create 时调用。

- [ ] **Step 1: Tests with fake `now`**
  - 两次 enqueue 同规则：第二条 skipped `rule_running`
  - 三条不同规则同时 running 上限 2：第三条 skipped `global_concurrency`
  - disabled 的 cron tick 不写 run
  - `now` 设到匹配分钟才写 running
  - 把 `now` 拨过匹配分钟再拨回同一分钟不因 lastTick 重复打（同一 lastTickMinute 跳过）

- [ ] **Step 2–4:** 实现；测试里 **不要** 真起 15s interval，只调 `tick()`。`createAutomationRuntime` 默认不 start interval，`appContext` 里 `runtime.start()`。

- [ ] **Step 5: Commit** `feat(server): automation enqueue and cron tick`

---

### Task 5: IssueStore subscribe + Issue hook

**Files:**
- Modify: `packages/server/src/services/issueStore.ts` 增加 `subscribe(fn: (e: { event: "created"|"review"|"completed"|"cancelled"; issue: Issue }) => void): () => void`
- Modify: `complete`/`cancel`/`create`/`maybeEnterReview` 在成功变更后 emit。`maybeEnterReview` **仅**当旧 status !== `review` 且新 === `review` 时 emit `review`
- Modify: `automationRuntime.ts` 在 construct 时 subscribe，匹配 `type:"issue"` 的 enabled 规则（events 包含；tags 若有则每个 tag 都在 issue.tags；priority 若有则相等）后 enqueue
- Test: `packages/server/tests/issueStore.subscribe.test.ts` + runtime 里一条 hook 测试

- [ ] **Step 1–4:** review 期间再 dispatch（`maybeEnterReview` no-op）不第二次 emit；create 命中 tags 过滤

- [ ] **Step 5: Commit** `feat(server): issue hooks for automations`

---

### Task 6: 隐藏 session + RunExecutor + 回合结束

**Files:**
- Modify: `sessionStore.ts` — `Session.origin?: "user" | "automation"` 默认 `"user"`；`create` 接受 `origin`；`listGrouped` filter `origin !== "automation"`
- Modify: `routes/sessions.ts` — `GET /sessions` 的非 grouped 列表 filter 掉 automation；`GET /sessions/:id` 不 filter
- Modify: `sessionRunner/agent.ts` `enabledPluginDirs`：若 `session.origin === "automation"`，不挂 issue、稍后也不挂 automation（Task 7 加 plugin 名）
- Modify: `automationRuntime.ts` 真 `startSession`：校验 `fs.existsSync(workdir)` 否则 `failed`/`error: workdir`；`store.create({ origin: "automation", workdir, permissionMode: "bypassPermissions", title: \`自动化 · ${name}\`, disallowedTools: ["Workflow"], agentName, model })`；`runner.sendMessage(sessionId, { text })` 其中 issue 触发前缀：

```
触发：Issue
ID：{id}
标题：{title}
状态：{status}
优先级：{priority}
标签：{tags}
描述：
{description 截断 2000 字}

---
{prompt}
```

cron/once/manual 前缀 `触发：定时 {ISO}` / `触发：单次` / `触发：手动`。

- Modify: `appContext.ts` 现有 `setOnTurnSettled` **链式**调用：先 `dispatcher.handleTurnSettled`，再若 run.sessionId 匹配则 `succeeded`/`failed`/`stopped`（result 带 interrupt 用 stopped）
- Test: sessionStore grouped 不含 automation；HTTP GET /sessions 不含、GET by id 含；runtime 用 `createAppContext({ createAgent })` 假 agent 跑完 run 变 succeeded；启动时磁盘 running → failed

查 `handleTurnSettled` / `TurnSettledResult` 现有字段，interrupt 对齐 issueDispatch。

- [ ] **Step 5: Commit** `feat(server): run automations in hidden sessions`

---

### Task 7: 内置 plugin `automation`

**Files:**
- Create: `packages/server/plugins/automation/.muse-plugin/plugin.json`（name `automation`）
- Create: `packages/server/plugins/automation/skills/automation-management/SKILL.md`
- Create: `packages/server/plugins/automation/skills/automation-management/scripts/automation.mjs`（抄 `issue.mjs` 的 Base URL 解析：`MUSE_SERVER_URL` / `MUSE_HOME`/`server-url` / 默认 8787）
- Modify: `sessionRunner/agent.ts` `enabledPluginDirs`：非 issue-exec 且 `origin !== "automation"` 时 push automation plugin dir（`pluginDirIfPresent("automation")`）；issue-exec 与 automation origin 都不挂
- Test: `packages/server/tests/automationPluginScript.test.ts` 用 `execFileAsync` + `listenTestApp`（**禁止 execFileSync**）

命令：`create --name --prompt --workdir [--cron EXPR]* [--issue-events created,review] [--description] [--model] [--agent]`；`list`/`get`/`update`/`enable`/`disable`/`run`/`runs`/`delete`。SKILL.md 写明：禁止未明确时删除；「暂停」= disable；workdir 用当前会话路径由模型传入。

- [ ] **Step 5: Commit** `feat(server): automation-management skill`

---

### Task 8: Webview 独立页

**Files:**
- Modify: `packages/webview/src/muse/apiClient.ts` 增加 Automation 类型与 `listAutomations` / `createAutomation` / `patchAutomation` / `enableAutomation` / `disableAutomation` / `deleteAutomation` / `runAutomation` / `listAutomationRuns` / `stopAutomationRun` / `getSession`
- Modify: `packages/webview/src/muse/wsClient.ts` 或 hostBridge：`automation:changed` 时刷新列表（对齐 `issue:changed`）
- Modify: `ChatApp.tsx` `MainView` 增加 `"automations"`；侧栏 `activeMenu` 在该 view 为 `"automations"`
- Modify: `DesktopSidebar.tsx` / `DesktopShell.tsx`：在「新对话」下增加 `app-menu`「自动化」，`onOpenAutomations`
- Create: `packages/webview/src/components/automation/AutomationsPage.tsx` 列表（对照原型卡片）
- Create: `packages/webview/src/components/automation/AutomationEditor.tsx`：未命名 contenteditable、开关、工作目录选择（复用 `desktopPickDirectory` 或已有 workdir 列表）、Tab 设置/运行记录、添加触发器（定时：周期/间隔/单次控件；Issue 事件多选）、Agent 指令 textarea + 模型下拉（`GET /agents` 或现有 model select）、立即运行、删除确认
- Create: `packages/webview/src/components/automation/AutomationTranscript.tsx` 右侧抽屉：`getSessionMessages` 只读，无 composer；running 显示停止
- Create: `packages/webview/src/styles/AutomationsPage.css` 对齐原型深色页，不要新建设计语言
- Test: `packages/webview/tests/components/automationsPage.test.tsx` — 渲染列表、点菜单出现独立页、侧栏 session tree **没有**规则名；编辑器没有 cron 文本框有「添加触发器」；停用时立即运行 disabled

工作目录：编辑器 `select` 用 host 已见 workdir + 「选择目录…」走 `desktopPickDirectory`。

PATCH 把 UI schedule `compile` 放 server：编辑器提交 `{ schedule }` 或 `triggers` 已编译对象（webview 可只发 UI 形状，server Task 3 已收 `schedule`）。多触发器：`triggers` 数组，每项 `{ type:"cron", expr }` 或 `{ type:"once", at }` 或 issue；webview 用本地小函数生成 expr（与 `scheduleCompile` **同一映射**，可把 `scheduleCompile.ts` 抽到双方能 import 的包，或 webview 复制常量表 `daily/weekday/1-6` + interval 白名单，注释「必须与 scheduleCompile.ts 一致」）。优先：webview 只发 UI 对象 `triggersUi: ScheduleUi | issue`，server 编译。

- [ ] **Step 5: Commit** `feat(webview): dedicated automations page`

---

### Task 9: CONTEXT.md + spec 收口

**Files:**
- Modify: `CONTEXT.md` 增加 Automation / AutomationRun / 触发器词汇
- Modify: spec 状态保持「已批准」；若草稿 enable 规则与 spec「name 必填」冲突，在 spec Implementation Decisions 加一句：未启用草稿允许空字段，启用前必须齐。

- [ ] **Step 1:** 改文档
- [ ] **Step 2: Commit** `docs: automation vocabulary`

---

## Spec coverage（自检）

| 需求 | Task |
|---|---|
| Store + 100 条裁剪 | 1 |
| 周期/间隔/单次 UI→cron/once | 2, 8 |
| REST CRUD enable/disable 幂等 | 3 |
| 停用后不 enqueue、run 403 | 3, 4 |
| 并发 skip | 4 |
| cron tick 不补跑 | 4 |
| once firedAt | 4 |
| Issue hook + review 去重 | 5 |
| hidden session + 权限档 | 6 |
| 回合结束更新 run | 6 |
| GET sessions 过滤 | 6 |
| skill | 7 |
| 独立页面编辑器 | 8 |
| transcript 只读 | 8 |
| CONTEXT 词汇 | 9 |
| 不挂 automation/issue 于运行 session | 6, 7 |

未做（spec Out of Scope）：GitHub 轮询、webhook、系统通知、排队、云端补跑。
