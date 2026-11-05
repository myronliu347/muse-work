# AI 助理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一条长期助理会话，用事件队列叫醒它，由它通过 Issue 协调工作，并用按 1 MiB 切片的 JSONL 保存、展示 Muse 对话。

**Architecture:** 服务端 `assistant` 目录放记录、队列、事件正文、运行时和七个进程内工具。助理会话 `origin` 为 `assistant`，`tools` 白名单只有这七个，`customTools` 在创建 agent 时注入，不挂 issue / automation 插件。Muse 界面只读 JSONL，不渲染 transcript。推送事件名是 `assistant:chat`，因为 `assistant:message` 已被会话流占用。

**Tech Stack:** TypeScript、Vitest、Hono、现有 `SessionRunner.sendMessage(..., "system-inject")`、React webview。

## Global Constraints

- 一条助理会话。session store 里 `origin === "assistant"` 的那条复用，没有则创建，不建第二条，不另建索引文件。
- 工作目录 `<home>/assistant-chat`。权限 `bypassPermissions`。
- 不挂载 issue-management。工具只有：`ListIssues`、`ListWorkdirs`、`CreateIssue`、`OpenIssue`、`MessageIssue`、`SendMessage`、`ListMuseMessages`。
- 不建清单、不 dispatch、不完成、不取消。`OpenIssue` 不启用 worktree。未传 `agentMode` 时为 `single`。`CreateIssue` 未传优先级时为 `p1`，标签默认空。
- 事件全部 `system-inject`。队列文件 `db/assistant-queue.json`，FIFO，重启后续跑。一次只放行队首。
- 对话记录目录 `db/assistant-messages/`，文件 `000001.jsonl` 起。追加前若当前片已达 1048576 字节则换片。一行一条，不拆行。单行可超过 1 MiB 并独占当前片。
- 行格式：`{"id","at","role":"user"|"assistant","message"}`。`role: user` 仅 Muse 发送。`role: assistant` 仅 `SendMessage` 且 `app: muse` 成功。外部频道是否写入由插件决定。存储不截断。
- `GET /assistant/messages?before=<id>&limit=50` 按时间从早到晚返回，带 `hasMore`。新行 websocket 事件 `assistant:chat`。
- `ListMuseMessages`：默认 50，最大 50；`before` 翻更早页；`q` 最多 8 个文件或 8 MiB；返回正文超过 8000 码点则 `truncated: true`；未扫完 `truncatedScan: true`。
- issue 事件字段只有 `type`、`issueId`、`title`、`workdir`、`summary`。`summary` 截断 8000 码点。执行会话结束和规划会话结束各一条。
- automation 事件含 `skipped`。`summary` 同样截断 8000。`error` 仅在有运行错误时出现。
- chat 事件：`from` 为 `muse` 或宿主插件的渠道 id。空字段省略。
- 回合失败：队首留下，正文追加 `retry: 1` 与 `error: <原因>`，再注入一次。第二次失败：出队，transcript 写失败记录，不进 JSONL，不经过模型。
- 外部频道的入队由宿主插件完成。
- 助理自己的回合不入队。
- 界面第一次 50 行，滚到顶再向更早要。侧栏入口不进普通会话列表。

---

### Task 1: Muse 对话 JSONL

**Files:**
- Create: `packages/server/src/services/assistant/messages.ts`
- Test: `packages/server/tests/assistantMessages.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `MuseChatLine = { id: string; at: number; role: "user" | "assistant"; message: string }`
  - `createAssistantMessageLog({ home, now?, newId? }): { append(role, message): MuseChatLine; page(args?: { before?: string; limit?: number }): { messages: MuseChatLine[]; hasMore: boolean }; search(args: { q: string; before?: string; limit?: number }): { messages: Array<MuseChatLine & { truncated?: boolean }>; hasMore: boolean; truncatedScan?: boolean } }`
  - 常量 `ASSISTANT_SLICE_BYTES = 1_048_576`、`ASSISTANT_PAGE_SIZE = 50`、`ASSISTANT_SEARCH_MAX_FILES = 8`、`ASSISTANT_SEARCH_MAX_BYTES = 8_388_608`、`ASSISTANT_TEXT_MAX = 8000`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { createAssistantMessageLog } from "../src/services/assistant/messages.js";

function home() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-msg-"));
}

describe("assistant message log", () => {
  it("appends user then assistant lines and pages newest 50 oldest-first", () => {
    let n = 0;
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1_700_000_000_000 + n,
      newId: () => `id-${++n}`,
    });
    log.append("user", "你好");
    log.append("assistant", "在");
    const page = log.page();
    expect(page.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(page.messages[0]).toMatchObject({ id: "id-1", message: "你好" });
    expect(page.hasMore).toBe(false);
  });

  it("rotates when the current slice is already 1 MiB", () => {
    const dirHome = home();
    const log = createAssistantMessageLog({
      home: dirHome,
      now: () => 1,
      newId: () => "a",
    });
    log.append("user", "x".repeat(1_048_576));
    log.append("assistant", "next");
    const dir = path.join(getMuseHomeDir(dirHome), "db", "assistant-messages");
    expect(fs.readdirSync(dir).sort()).toEqual(["000001.jsonl", "000002.jsonl"]);
    const second = fs.readFileSync(path.join(dir, "000002.jsonl"), "utf8");
    expect(second).toContain("next");
  });

  it("pages older rows across slices with before", () => {
    let n = 0;
    const log = createAssistantMessageLog({
      home: home(),
      now: () => ++n,
      newId: () => `id-${n}`,
    });
    for (let i = 0; i < 3; i++) log.append("user", `m${i}`);
    const page = log.page({ before: "id-3", limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual(["id-1", "id-2"]);
    expect(page.hasMore).toBe(false);
  });

  it("search returns a matching line from the newest slice", () => {
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1,
      newId: () => "only",
    });
    log.append("user", "find-me " + "z".repeat(200));
    const found = log.search({ q: "find-me", limit: 50 });
    expect(found.messages).toHaveLength(1);
    expect(found.truncatedScan).toBeUndefined();
  });

  it("truncates tool-facing message at 8000 code points", () => {
    const log = createAssistantMessageLog({
      home: home(),
      now: () => 1,
      newId: () => "long",
    });
    log.append("assistant", "你".repeat(8001));
    const found = log.search({ q: "你", limit: 1 });
    expect([...found.messages[0].message].length).toBe(8000);
    expect(found.messages[0].truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantMessages.test.ts`

Expected: FAIL，找不到 `../src/services/assistant/messages.js`

- [ ] **Step 3: Write minimal implementation**

`packages/server/src/services/assistant/messages.ts`：

- `dir = path.join(getMuseHomeDir(home), "db", "assistant-messages")`
- 文件名 `/^\d{6}\.jsonl$/`，按名字排序。没有文件时下一片是 `000001.jsonl`
- `append`：若最新文件 `stat.size >= 1_048_576`，序号 +1。`fs.appendFileSync` 一行 `JSON.stringify(line) + "\n"`
- 读取：从最新文件往旧文件扫，跳过空行和坏 JSON。`page` 收集 `before` 之前的行（无 `before` 则全部），保留最后 `limit`（默认 50，最大 50），再按 `at` 升序。`hasMore` 表示这页之前还有行
- `search`：同样从新到旧，只对 `message.includes(q)` 的行计数。扫描字节达到 `8_388_608` 或文件数达到 8 时，若后面还有未读文件或当前文件未读完，设 `truncatedScan: true`。命中的 `message` 用码点截到 8000 并设 `truncated: true`。`page` 不截断

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantMessages.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/assistant/messages.ts packages/server/tests/assistantMessages.test.ts
git commit -m "feat: store assistant muse chat in sliced jsonl"
```

---

### Task 2: 助理会话身份

**Files:**
- Modify: `packages/server/src/services/sessionStore.ts`（`origin` 联合类型与 `listGrouped` 过滤）
- Modify: `packages/server/src/routes/sessions.ts`（列表排除 `assistant`）
- Modify: `packages/server/src/services/sessionRunner/agent.ts`（`enabledPluginDirs`：`origin === "assistant"` 时不挂任何插件）
- Create: `packages/server/src/services/assistant/session.ts`
- Create: `packages/server/src/services/assistant/prompt.ts`
- Test: `packages/server/tests/assistantSession.test.ts`

**Interfaces:**
- Consumes: `SessionStore.create` / `list`
- Produces:
  - `ASSISTANT_TOOL_NAMES = ["ListIssues","ListWorkdirs","CreateIssue","OpenIssue","MessageIssue","SendMessage","ListMuseMessages"] as const`
  - `ASSISTANT_SYSTEM_PROMPT` 全文：

```text
你是长期助理。每条系统注入是一个事件，字段 type 为 chat、issue 或 automation。
用 ListIssues 按工作目录、标题、描述判断。对得上就 MessageIssue；还没开会话就先 OpenIssue。对不上就 CreateIssue、OpenIssue、MessageIssue。
目录选不出就 SendMessage 回问。issue 和 automation 可以不调用任何工具。
回复人必须调用 SendMessage。app 为 muse 写给 Muse 用户，其他 app 交给注册了该渠道的宿主插件。
禁止创建清单、dispatch、完成、取消。OpenIssue 拿不准模式就用 single。
transcript 压缩后，用 ListMuseMessages 回查 Muse 对话。
```
  - `ensureAssistantSession(store, args: { home: string; model: string }): Session`
    - 已有 `origin === "assistant"` 则返回第一条
    - 否则 `store.create({ origin: "assistant", workdir: path.join(home, "assistant-chat"), permissionMode: "bypassPermissions", title: "助理", model, systemPrompt: ASSISTANT_SYSTEM_PROMPT, tools: [...ASSISTANT_TOOL_NAMES] })`
    - 创建前 `fs.mkdirSync(workdir, { recursive: true })`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "../src/services/sessionStore.js";
import {
  ASSISTANT_TOOL_NAMES,
  ensureAssistantSession,
} from "../src/services/assistant/session.js";

describe("ensureAssistantSession", () => {
  it("creates one assistant session and reuses it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-sess-"));
    const store = createSessionStore({ home });
    const first = ensureAssistantSession(store, { home, model: "m" });
    const second = ensureAssistantSession(store, { home, model: "m" });
    expect(second.id).toBe(first.id);
    expect(first.origin).toBe("assistant");
    expect(first.workdir).toBe(path.join(home, "assistant-chat"));
    expect(first.permissionMode).toBe("bypassPermissions");
    expect(first.tools).toEqual([...ASSISTANT_TOOL_NAMES]);
    expect(store.list().filter((s) => s.origin === "assistant")).toHaveLength(1);
    expect(store.listGrouped().recent.map((s) => s.id)).not.toContain(first.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantSession.test.ts`

Expected: FAIL，`origin: "assistant"` 不能赋值，或 `ensureAssistantSession` 不存在

- [ ] **Step 3: Write minimal implementation**

- `sessionStore.ts`：`origin?: "user" | "automation" | "assistant"`。`create` 里保留传入的 `assistant`，只有缺省才落到 `user`。`listGrouped` 的过滤改为 `origin !== "automation" && origin !== "assistant"`
- `routes/sessions.ts` 列表过滤同样排除 `assistant`
- `agent.ts` 的 `enabledPluginDirs`：`session?.origin === "assistant"` 时直接 `return dirs` 之前先 return 空插件列表（不要 push issue / automation）。把参数类型里的 `origin` 扩成 `"user" | "automation" | "assistant"`
- 按 Interfaces 实现 `session.ts` 与 `prompt.ts`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantSession.test.ts tests/sessionStore.persist.test.ts`

Expected: PASS。已有「排除 automation」的用例仍通过

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/sessionStore.ts packages/server/src/routes/sessions.ts packages/server/src/services/sessionRunner/agent.ts packages/server/src/services/assistant/session.ts packages/server/src/services/assistant/prompt.ts packages/server/tests/assistantSession.test.ts
git commit -m "feat: add a single long-lived assistant session"
```

---

### Task 3: 事件正文与持久队列

**Files:**
- Create: `packages/server/src/services/assistant/events.ts`
- Create: `packages/server/src/services/assistant/queue.ts`
- Test: `packages/server/tests/assistantQueue.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `AssistantEvent` 三种，另加可选 `retry?: 1` 与 `turnError?: string`
  - `formatAssistantEvent(event: AssistantEvent): string` 一行一个字段，空字段省略。`summary` 用码点截到 8000。`retry === 1` 时在正文末尾追加 `retry: 1` 和 `error: <turnError>`
  - `createAssistantQueue({ home }): { enqueue(event: AssistantEvent): void; peek(): AssistantEvent | undefined; dropHead(): void; markRetry(turnError: string): void }`
  - 文件 `path.join(getMuseHomeDir(home), "db", "assistant-queue.json")`，形状 `{ version: 1, events: AssistantEvent[] }`。构造时读取，每次变更原子写入

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMuseHomeDir } from "@muse-work/provider";
import { formatAssistantEvent } from "../src/services/assistant/events.js";
import { createAssistantQueue } from "../src/services/assistant/queue.js";

describe("assistant events and queue", () => {
  it("formats the three event kinds and omits empty fields", () => {
    expect(formatAssistantEvent({
      type: "chat",
      from: "channel",
      message: "你好",
      user: "a@corp",
      groupId: "g1",
    })).toBe("type: chat\nfrom: channel\nmessage: 你好\nuser: a@corp\ngroupId: g1");
    expect(formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      summary: "你".repeat(8001),
    })).toContain("type: issue");
    const issue = formatAssistantEvent({
      type: "issue",
      issueId: "i1",
      title: "登录",
      workdir: "/repo",
      summary: "你".repeat(8001),
    });
    const summary = issue.split("summary: ")[1];
    expect([...summary].length).toBe(8000);
    expect(formatAssistantEvent({
      type: "automation",
      automationId: "a",
      name: "巡检",
      runId: "r",
      workdir: "/repo",
      status: "skipped",
      trigger: "cron",
    })).not.toContain("error:");
  });

  it("persists fifo order and reloads", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-q-"));
    const q = createAssistantQueue({ home });
    q.enqueue({ type: "chat", from: "muse", message: "1" });
    q.enqueue({ type: "chat", from: "muse", message: "2" });
    expect(q.peek()).toMatchObject({ message: "1" });
    q.dropHead();
    const again = createAssistantQueue({ home });
    expect(again.peek()).toMatchObject({ message: "2" });
    expect(fs.existsSync(path.join(getMuseHomeDir(home), "db", "assistant-queue.json"))).toBe(true);
  });

  it("markRetry keeps the head and appends retry lines", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-q2-"));
    const q = createAssistantQueue({ home });
    q.enqueue({ type: "chat", from: "muse", message: "1" });
    q.markRetry("boom");
    expect(formatAssistantEvent(q.peek()!)).toContain("retry: 1\nerror: boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantQueue.test.ts`

Expected: FAIL，模块不存在

- [ ] **Step 3: Write minimal implementation**

按 Interfaces 实现。`formatAssistantEvent` 的字段顺序：

- chat：`type` `from` `message` `user` `groupId`
- issue：`type` `issueId` `title` `workdir` `summary`
- automation：`type` `automationId` `name` `runId` `workdir` `status` `trigger` `error` `summary`

`markRetry`：若队首 `retry` 已是 `1`，不改（调用方负责第二次失败）。否则写入 `retry: 1` 与 `turnError`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantQueue.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/assistant/events.ts packages/server/src/services/assistant/queue.ts packages/server/tests/assistantQueue.test.ts
git commit -m "feat: persist the assistant event queue"
```

---

### Task 4: 事件循环

**Files:**
- Create: `packages/server/src/services/assistant/runtime.ts`
- Test: `packages/server/tests/assistantRuntime.test.ts`

**Interfaces:**
- Consumes: `createAssistantQueue`、`formatAssistantEvent`、`ensureAssistantSession`、`SessionRunner.sendMessage(sessionId, content, undefined, "system-inject")`、`SessionStore`
- Produces: `createAssistantRuntime(options): { enqueue(event: AssistantEvent): void; onAssistantTurnSettled(sessionId: string, result: { ok: boolean; error?: string }): void; start(): void; stop(): void }`
  - `options`: `{ home, model, sessions, runner, queue, now? }`
  - `enqueue` 只入队并尝试泵出。不在这里判断要不要建 Issue
  - 泵出：队首存在且助理会话不是 `running` 时，`sendMessage(assistantId, formatAssistantEvent(head), undefined, "system-inject")`
  - `onAssistantTurnSettled`：`sessionId` 不是助理则忽略。`ok` 则 `dropHead` 再泵。失败且队首还没有 `retry` 则 `markRetry(result.error ?? "failed")` 再泵。已有 `retry` 则 `dropHead`，调用 `runner.appendSystemNote(assistantId, content)` 写入失败记录，然后泵下一条。`content` 为 `type: failure` 与 `error: ...`，由 `appendSystemNote` 包成 `system-inject`。禁止用 `sendMessage` 写这条记录，那会再开一轮模型。
  - `start` 调用 `ensureAssistantSession` 并泵出重启后留下的队首

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSessionStore } from "../src/services/sessionStore.js";
import { createAssistantQueue } from "../src/services/assistant/queue.js";
import { createAssistantRuntime } from "../src/services/assistant/runtime.js";

describe("assistant runtime", () => {
  it("injects one event at a time and retries once", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "muse-asst-rt-"));
    const sessions = createSessionStore({ home });
    const sends: Array<{ sessionId: string; content: string; source?: string }> = [];
    let running = false;
    const runner = {
      sendMessage: async (sessionId: string, content: string, _images?: unknown, source?: string) => {
        sends.push({ sessionId, content, source });
        running = true;
        sessions.update(sessionId, {});
        return { accepted: true as const };
      },
    };
    const queue = createAssistantQueue({ home });
    const runtime = createAssistantRuntime({
      home,
      model: "m",
      sessions: sessions as never,
      runner: runner as never,
      queue,
    });
    runtime.start();
    const assistantId = sessions.list().find((s) => s.origin === "assistant")!.id;
    runtime.enqueue({ type: "chat", from: "muse", message: "一" });
    runtime.enqueue({ type: "chat", from: "muse", message: "二" });
    expect(sends).toHaveLength(1);
    expect(sends[0].source).toBe("system-inject");
    expect(sends[0].content).toContain("message: 一");
    runtime.onAssistantTurnSettled(assistantId, { ok: false, error: "boom" });
    expect(sends).toHaveLength(2);
    expect(sends[1].content).toContain("retry: 1");
    expect(sends[1].content).toContain("error: boom");
    const notes: string[] = [];
    runner.appendSystemNote = async (_sessionId: string, content: string) => {
      notes.push(content);
    };
    runtime.onAssistantTurnSettled(assistantId, { ok: false, error: "boom" });
    expect(notes[0]).toContain("type: failure");
    expect(sends.some((s) => s.content.includes("message: 二"))).toBe(true);
    expect(running).toBe(true);
  });
});
```

测试里 `sessions.update` 不改变 `status`。实现不要依赖 `running` 标志来自这个假 runner；用 runtime 内部的 `inflight` 布尔。上面的 `running` 变量可以留着，断言只看 `sends`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantRuntime.test.ts`

Expected: FAIL，`createAssistantRuntime` 不存在

- [ ] **Step 3: Write minimal implementation**

`runtime.ts` 用内部 `inflight`。`sendMessage` 抛错视作这次注入失败：走与回合失败相同的重试路径（`markRetry` 或丢弃）。`onAssistantTurnSettled` 在 `sessionId` 不匹配时返回。

`appendSystemNote` 加在 `SessionRunner`：取该会话的 agent，`messageManager.addUserMessage` 写入已用 `<system-inject>` 包好的正文，`saveSession()`，不调用 `runTurn`。没有 agent 时先 `ensureAgent` 再写。不要广播成需要模型回复的用户消息。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantRuntime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/assistant/runtime.ts packages/server/tests/assistantRuntime.test.ts
git commit -m "feat: run the assistant from a single-flight event loop"
```

---

### Task 5: 七个工具

**Files:**
- Create: `packages/server/src/services/assistant/tools.ts`
- Test: `packages/server/tests/assistantTools.test.ts`
- Modify: `packages/server/src/services/sessionRunner/agent.ts`（`origin === "assistant"` 时把 `customTools` 传给 `createAgent`，并让 `tools` 白名单生效）

**Interfaces:**
- Consumes: `IssueStore`、`SessionStore`、`SessionRunner.sendMessage`、`createAssistantMessageLog`、`AutomationStore.list`
- Produces: `createAssistantTools(deps): ToolPlugin[]`，名字与 `ASSISTANT_TOOL_NAMES` 一致。`execute` 返回 `{ success, content, error? }`，`content` 为 JSON 字符串
  - `ListIssues`：未完成 Issue 的 `id` `title` `description` `workdir` `sessionOpen`（`planningSessionId` 是否存在）
  - `ListWorkdirs`：Issue（含已关闭、有 `workdir`）、自动化 `workdir`、`origin === "user"` 的会话 `workdir`，`fs.existsSync` 后去重
  - `CreateIssue`：`title` `description` 必填；`priority` 默认 `p1`；`tags` 默认 `[]`
  - `OpenIssue`：`issueId` `workdir` 必填；`agentMode` 默认 `single`。目录不存在返回 `success: false`。已有 `planningSessionId` 则返回现有 `sessionId` 与 `workdir`，不调用打开逻辑。否则调用与 `POST /issues/:id/sessions` 相同的打开函数，`worktreeEnabled: false`
  - `MessageIssue`：向该 Issue 的 `planningSessionId` `sendMessage(content)`，source 默认用户消息（不要 `system-inject`）。无会话则 `success: false`，错误文案 `session not open`
  - `SendMessage`：`app: "muse"` 成功则 `log.append("assistant", message)` 并 `hub.broadcastAll({ type: "assistant:chat", line })`。其他 `app` 交给注册了该渠道的宿主插件；没人注册则失败。失败不 `append`
  - `ListMuseMessages`：参数 `before?` `q?` `limit?`。有 `q` 走 `log.search`，否则 `log.page` 再把超 8000 码点的 `message` 截断并加 `truncated`

打开会话不要在工具里复制 HTTP 解析。从 `packages/server/src/routes/issues.ts` 抽出 `openIssueSession(ctx, issueId, body)`，路由与 `OpenIssue` 共用。`body` 为 `{ workdir, agentMode, worktreeEnabled: false }`。

`agent.ts`：`createAgent` 的 options 增加 `customTools`。仅当 `session.origin === "assistant"` 且构造 runner 时注入了 `getAssistantTools?: () => ToolPlugin[]`。在 `createSessionServices` / runner 工厂增加这个可选回调，由 Task 6 赋值。本任务先把参数接上；工具单测直接调用 `createAssistantTools`，不启动模型。

- [ ] **Step 1: Write the failing test**

覆盖：`CreateIssue` 默认 `p1` 与空标签；`OpenIssue` 目录不存在失败、再次调用返回同一 `sessionId`、`worktreeEnabled` 不为 true；`MessageIssue` 在无会话时失败；`SendMessage` muse 追加一行，未注册的 app 失败并不写记录；`ListMuseMessages` 对 8001 个「你」返回 `truncated: true`。用 `fs.mkdtempSync` 做 home，`createIssueStore`、`createSessionStore`、`createAssistantMessageLog`。

`OpenIssue` 的打开依赖抽出的 `openIssueSession`。测试给一个假实现：`openIssueSession: (id, body) => { opened.push(body); return { sessionId: "s1", workdir: body.workdir }; }`，并让 Issue 在假实现里被 `setPlanning`。第二次调用时期望 `opened` 仍为 1。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantTools.test.ts`

Expected: FAIL，`createAssistantTools` 不存在

- [ ] **Step 3: Write minimal implementation**

按 Interfaces 实现 `tools.ts`，并从 `issues.ts` 抽出 `openIssueSession`。工具 schema 的 `parameters` 用 JSON Schema。`SendMessage.app` 为 `muse` 或插件注册的渠道。`OpenIssue.agentMode` enum `["single","split"]`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantTools.test.ts tests/issues.routes.test.ts`

Expected: PASS。原有打开会话路由仍可用

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/assistant/tools.ts packages/server/src/routes/issues.ts packages/server/src/services/sessionRunner/agent.ts packages/server/tests/assistantTools.test.ts
git commit -m "feat: add the assistant coordination tools"
```

---

### Task 6: 接上 Issue、自动化与 HTTP

**Files:**
- Modify: `packages/server/src/services/appContext.ts`
- Modify: `packages/server/src/services/automationRuntime.ts`（`handleTurnSettled` 末尾调用可选 `onRunSettled`）
- Create: `packages/server/src/routes/assistant.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/services/wsEvents.ts`（增加 `{ type: "assistant:chat"; line: MuseChatLine }`，不要改现有 `assistant:message`）
- Test: `packages/server/tests/assistantWiring.test.ts`

**Interfaces:**
- Consumes: Task 1–5 的工厂
- Produces:
  - `appContext` 上的 `assistantRuntime`
  - `GET /assistant/messages`
  - Issue 绑定会话回合结束 → `enqueue` 一条 `type: issue`（`summary` 用已导出的 `lastAssistantText`）
  - 自动化 `handleTurnSettled` 改完状态后 `onRunSettled(run, automation)` → `enqueue` 一条 `type: automation`。`summary` 来自该 run 的 `sessionId` 的 `lastAssistantText`，没有会话则省略

外部频道的入队和发送在宿主插件里，不改宿主。

`setOnTurnSettled` 现有回调先保持 `dispatcher` 与 `automationRuntime`。再调用 `assistantRuntime.onAssistantTurnSettled`。另外若 `issueStore` 里某条未完成 Issue 的 `planningSessionId` 或 `executionSessionId` 等于 `sessionId`，且 `sessionId` 不是助理自己，则入队 issue 事件。执行会话与规划会话都会各自触发，因为它们是两次 `onTurnSettled`。

Muse 用户发送不走这个 HTTP 以外的路径。`POST /assistant/messages` body `{ message: string }`：空则 400；否则 `log.append("user", message)`，`hub.broadcastAll({ type: "assistant:chat", line })`，`runtime.enqueue({ type: "chat", from: "muse", message })`，返回 `{ line }`。

`GET /assistant/messages` 把 query `before` 与 `limit` 交给 `log.page`。

- [ ] **Step 1: Write the failing test**

`assistantWiring.test.ts`：用 `createAppContext` 不可行时（它会拉 provider），改为手工组装 store、queue、runtime、issueStore，与 `automationRuntime.test.ts` 的 `setup()` 一样注入假 runner。断言：

- 一个带 `planningSessionId` 的 Issue，对其 session 调用接线函数 `noteIssueTurn(sessionId)` 后，队列队首 `type === "issue"` 且 `summary` 来自假的 `getMessages`
- 自动化 run 结算为 `succeeded` 后队首 `type === "automation"`
- `POST /assistant/messages` 先有 JSONL 行，队列里有 `from: muse`
- 助理会话 id 的 `onTurnSettled` 不产生 `type: issue`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantWiring.test.ts`

Expected: FAIL，路由或 `onRunSettled` 不存在

- [ ] **Step 3: Write minimal implementation**

按 Interfaces 接线。`createAppContext` 在 runner 创建后调用 `sessions.runner.setAssistantTools(() => createAssistantTools(...))`，`agent.ts` 仅在 `origin === "assistant"` 时把该回调的返回值传给 `createAgent({ customTools })`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/server exec vitest run tests/assistantWiring.test.ts tests/automationRuntime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/appContext.ts packages/server/src/services/automationRuntime.ts packages/server/src/routes/assistant.ts packages/server/src/app.ts packages/server/src/services/wsEvents.ts packages/server/tests/assistantWiring.test.ts
git commit -m "feat: wake the assistant from issue and automation events"
```

---

### Task 7: Muse 界面

**Files:**
- Create: `packages/webview/src/components/assistant/AssistantPage.tsx`
- Modify: `packages/webview/src/components/desktop/DesktopSidebar.tsx`（自动化图标旁加「助理」按钮）
- Modify: `packages/webview/src/components/ChatApp.tsx` 与 `packages/webview/src/components/desktop/DesktopShell.tsx`（`view === "assistant"` 时渲染 `AssistantPage`，不渲染 transcript）
- Modify: `packages/webview/src/muse/apiClient.ts`（`listAssistantMessages`、`sendAssistantMessage`）
- Modify: `packages/webview/src/muse/wsClient.ts`（识别 `assistant:chat`）
- Test: `packages/webview/tests/components/assistantPage.test.tsx`

**Interfaces:**
- Consumes: `GET /assistant/messages`、`POST /assistant/messages`、`assistant:chat`
- Produces: 侧栏入口。打开后列表只渲染 JSONL：`role: user` 用户气泡，`role: assistant` 助理气泡。首次请求不带 `before`。滚到顶部且 `hasMore` 时用当前最早一条的 `id` 作 `before` 再请求，把结果接到前面。收到 `assistant:chat` 且用户停在底部时追加该行

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssistantPage } from "../../src/components/assistant/AssistantPage";

describe("AssistantPage", () => {
  it("renders jsonl roles and sends a user line", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "user", message: "你好" },
          { id: "2", at: 2, role: "assistant", message: "在" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn().mockResolvedValue({
        line: { id: "3", at: 3, role: "user", message: "继续" },
      }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("你好")).toBeTruthy();
    expect(screen.getByText("在")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "继续" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(api.sendAssistantMessage).toHaveBeenCalledWith("继续");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/assistantPage.test.tsx`

Expected: FAIL，组件不存在

- [ ] **Step 3: Write minimal implementation**

`AssistantPage` 按 Interfaces 实现。`DesktopSidebar` 在自动化按钮旁增加按钮，文案「助理」，`onOpenAssistant`。`ChatApp` 与 `DesktopShell` 增加 view `"assistant"`。不要把助理会话放进 `listGrouped` 的会话树。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muse-work/webview exec vitest run tests/components/assistantPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/assistant/AssistantPage.tsx packages/webview/src/components/desktop/DesktopSidebar.tsx packages/webview/src/components/ChatApp.tsx packages/webview/src/components/desktop/DesktopShell.tsx packages/webview/src/muse/apiClient.ts packages/webview/src/muse/wsClient.ts packages/webview/tests/components/assistantPage.test.tsx
git commit -m "feat: show the assistant muse chat from sliced history"
```
