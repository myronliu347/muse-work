# 记忆索引拒写与助手读会话窗口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MEMORY.md` 超限的写入不落盘，并告诉模型要腾出多少；助手的 `ReadSessionMessages` 每次只返回有上限的最近一段，别的会话全文不再进入助手上下文。

**Architecture:** 两部分互不依赖，可以分开提交。记忆闸门放在 `Write` / `Edit` 真正写盘之前，只针对自动记忆目录里的 `MEMORY.md`；没超限的写入、接近上限的提醒、话题文件的现有提醒都保持原样。加载时的截断继续留着，用来挡住磁盘上已经超限的旧索引。会话窗口只改助手工具 `ReadSessionMessages`：从最新消息往回取，正文合计不超过 8000 码点，并带回更早还有多少条。通用压缩、`getLastApiRounds`、Issue 会话自己的工具结果都不改。会话文件是只追加的，所以不在回合结束后改写已经落盘的工具结果。

**Tech Stack:** TypeScript、Vitest、现有 `Write`/`Edit`、`appendMemoryCapNotice`、助手工具 `ReadSessionMessages`。

## Global Constraints

- 索引上限保持 `MAX_MEMORY_ENTRYPOINT_LINES = 200`、`MAX_MEMORY_ENTRYPOINT_CHARS = 25_000`。压回目标保持 `cap * 0.7`（140 行 / 17_500 字）。
- 只拒绝会让 `MEMORY.md` 仍然超限的 `Write` 和 `Edit`。结果低于上限的缩短必须成功。
- 拒绝发生在快照和写盘之前。磁盘上的索引与这次调用之前相同。
- 话题文件（`MAX_MEMORY_FILE_BYTES` / `MAX_MEMORY_FILE_LINES`）仍然只附加提醒，写入成功。
- 接近上限（80%）的提醒文案不改。
- `ReadSessionMessages` 单次返回的正文合计不超过 `ASSISTANT_TEXT_MAX`（8000 码点）。超长的最新一条保留尾部。
- 返回结构从「纯数组」改为 `{ messages, omitted }`。`before` 是上一页最早一条的 `id`，不含这条，再往更早取。
- 助手自己的注入、回复、压缩摘要不动。不改 `compactMessagesAndUpdateSession`。

---

### Task 1: 超限的 MEMORY.md 写入在写盘前拒绝

**Files:**
- Modify: `packages/agent/src/utils/memoryCapNotices.ts`
- Modify: `packages/agent/src/tools/writeTool.ts`（快照之前）
- Modify: `packages/agent/src/tools/editTool.ts`（`atomicWriteFile` 之前，约 271 行）
- Modify: `packages/agent/src/prompts/memoryTypes.ts`（`buildHowToSaveSection` 里那句 truncated）
- Test: `packages/agent/tests/utils/memoryCapNotices.test.ts`
- Test: `packages/agent/tests/prompts/memoryPrompt.test.ts`

**Interfaces:**
- Consumes: `MAX_MEMORY_ENTRYPOINT_LINES`、`MAX_MEMORY_ENTRYPOINT_CHARS`、`MEMORY_CAP_TARGET_RATIO`、`MEMORY_ENTRYPOINT_NAME`、`ToolContext.autoMemoryDir`
- Produces:
  - `export function entrypointRejection(raw: string): string | null`
  - `export function rejectEntrypointWrite(absolutePath: string, next: string, autoMemoryDir: string | undefined): string | null`

- [x] **Step 1: 写失败测试**

在 `packages/agent/tests/utils/memoryCapNotices.test.ts` 把「says the write succeeded and names the consequence once the cap is passed」换成下面这个，并新增「under the cap returns null」：

```ts
it("rejects an index that is over the read limit and names the dropped tail", () => {
  const kept = Array.from({ length: 200 }, (_, i) => `kept ${i}`);
  const dropped = Array.from({ length: 5 }, (_, i) => `dropped ${i} ${"x".repeat(40)}`);
  const raw = [...kept, ...dropped].join("\n");

  const rejection = entrypointRejection(raw);

  expect(rejection).toContain("The file was not modified");
  expect(rejection).toContain("205 lines");
  expect(rejection).toContain(`over its ${MAX_MEMORY_ENTRYPOINT_LINES}-line read limit`);
  expect(rejection).toContain(`under ${target(MAX_MEMORY_ENTRYPOINT_LINES)} lines`);
  expect(rejection).toContain("dropped 0");
  expect(rejection).not.toContain("The write succeeded");
});

it("returns null when the index fits both caps", () => {
  const raw = Array.from({ length: 10 }, () => "short line").join("\n");
  expect(entrypointRejection(raw)).toBeNull();
});
```

`memoryPrompt.test.ts` 里 `lines after ${MAX_MEMORY_ENTRYPOINT_LINES} or characters past ${MAX_MEMORY_ENTRYPOINT_CHARS}` 改为：

```ts
expect(prompt).toContain(
  `a write that leaves it over ${MAX_MEMORY_ENTRYPOINT_LINES} lines or ${MAX_MEMORY_ENTRYPOINT_CHARS} characters is rejected and the file is left unchanged`,
);
```

- [x] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/utils/memoryCapNotices.test.ts tests/prompts/memoryPrompt.test.ts`（cwd: `packages/agent`）

Expected: FAIL，`entrypointRejection` 未定义，提示词仍是 `will be truncated`。

- [x] **Step 3: 实现拒绝文案和写盘前闸门**

在 `memoryCapNotices.ts` 增加：

```ts
export function entrypointRejection(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lineCount = trimmed.split("\n").length;
  const charCount = trimmed.length;
  const lineOver = lineCount > MAX_MEMORY_ENTRYPOINT_LINES;
  const charOver = charCount > MAX_MEMORY_ENTRYPOINT_CHARS;
  if (!lineOver && !charOver) return null;

  const limits: string[] = [];
  if (lineOver) {
    limits.push(
      `${lineCount} lines, over its ${MAX_MEMORY_ENTRYPOINT_LINES}-line read limit. Rewrite it to under ${targetOf(MAX_MEMORY_ENTRYPOINT_LINES)} lines`,
    );
  }
  if (charOver) {
    limits.push(
      `${charCount} characters, over its ${MAX_MEMORY_ENTRYPOINT_CHARS}-character read limit. Rewrite it to under ${targetOf(MAX_MEMORY_ENTRYPOINT_CHARS)} characters`,
    );
  }

  const dropped = trimmed
    .slice(findCut(trimmed))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 15)
    .map((line) => `- ${line.slice(0, 80)}`);

  return [
    `Error: The file was not modified. This write would have left ${MEMORY_ENTRYPOINT_NAME} at ${limits.join("; ")}.`,
    "Lines and characters past the read limit are dropped on load, so those entries would be invisible.",
    "Rewrite the whole index in one Write: one line per entry, detail lives in the topic file, merge or drop stale lines.",
    dropped.length > 0 ? `Entries that would not be loaded:\n${dropped.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function findCut(raw: string): number {
  const trimmed = raw.trim();
  const lines = trimmed.split("\n");
  let body = lines.length > MAX_MEMORY_ENTRYPOINT_LINES
    ? lines.slice(0, MAX_MEMORY_ENTRYPOINT_LINES).join("\n")
    : trimmed;
  if (body.length > MAX_MEMORY_ENTRYPOINT_CHARS) {
    const cutAt = body.lastIndexOf("\n", MAX_MEMORY_ENTRYPOINT_CHARS);
    body = body.slice(0, cutAt > 0 ? cutAt : MAX_MEMORY_ENTRYPOINT_CHARS);
  }
  return body.length;
}

export function rejectEntrypointWrite(
  absolutePath: string,
  next: string,
  autoMemoryDir: string | undefined,
): string | null {
  if (!autoMemoryDir) return null;
  if (!isPathInside(absolutePath, autoMemoryDir)) return null;
  if (path.basename(absolutePath) !== MEMORY_ENTRYPOINT_NAME) return null;
  return entrypointRejection(next);
}
```

`findCut` 的切法要和 `truncateEntrypointContent` 一样：先按行数切，再在字符上限前的最后一个换行处切。

`buildEntrypointCapNotice` 里 `worst.over` 的那句（含 `The write succeeded`）删掉。超限不再走提醒，因为写盘不会发生。`worst.frac >= 1` 时直接 `return` 其余非超限提醒之前先跳过这个 dimension：只保留 `!worst.over` 的 approaching 文案。超限文件如果因为别的路径已经在磁盘上，加载截断仍然生效，本任务不改 `truncateEntrypointContent`。

`writeTool.ts`：在 `recordSnapshot` 之前，`content` 已确定之后：

```ts
const rejection = rejectEntrypointWrite(
  resolvedPath,
  content,
  context.autoMemoryDir,
);
if (rejection) {
  return { success: false, content: "", error: rejection };
}
```

`editTool.ts`：在 `recordSnapshot` 之前，`newContent` 已确定、权限检查之后：

```ts
const rejection = rejectEntrypointWrite(
  resolvedPath,
  newContent,
  context.autoMemoryDir,
);
if (rejection) {
  return { success: false, content: "", error: rejection };
}
```

`buildHowToSaveSection` 那一条改为：

```ts
`- \`${MEMORY_ENTRYPOINT_NAME}\` is always loaded into your conversation context — a write that leaves it over ${MAX_MEMORY_ENTRYPOINT_LINES} lines or ${MAX_MEMORY_ENTRYPOINT_CHARS} characters is rejected and the file is left unchanged. Keep the index concise`,
```

- [x] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/utils/memoryCapNotices.test.ts tests/prompts/memoryPrompt.test.ts tests/managers/toolManager.autoMemory.test.ts`（cwd: `packages/agent`）

Expected: PASS。`toolManager.autoMemory.test.ts` 里那条「appends the capacity notice」用的是假 `Write`，不会走到 `writeTool.ts`。它 mock 的文件有 250 行，`appendMemoryCapNotice` 仍会在成功结果上附加提醒。超限分支从 `buildEntrypointCapNotice` 去掉之后，这条测试会失败：假的 Write 已经成功，提醒函数不再把超限说成 Error。把这条测试的文件内容改成 170 行短行（仍超过 80% 的 160 行警告线，低于 200），期望文案改为 `approaching the`，写入结果仍然是 success。这样假工具覆盖「接近上限仍成功」，真闸门由 `memoryCapNotices` 的纯函数测试覆盖。

- [x] **Step 5: Commit**

```bash
git add packages/agent/src/utils/memoryCapNotices.ts packages/agent/src/tools/writeTool.ts packages/agent/src/tools/editTool.ts packages/agent/src/prompts/memoryTypes.ts packages/agent/tests/utils/memoryCapNotices.test.ts packages/agent/tests/prompts/memoryPrompt.test.ts packages/agent/tests/managers/toolManager.autoMemory.test.ts
git commit -m "$(cat <<'EOF'
fix: reject a MEMORY.md write that would exceed the index cap

The index used to save and then drop the tail on load. A write that still ends over the limit now fails before it touches disk, and the tool error names how far over it is and which lines would be invisible.

EOF
)"
```

---

### Task 2: ReadSessionMessages 只返回最近一段

**Files:**
- Modify: `packages/server/src/services/assistant/tools/messageTools.ts`（`ReadSessionMessages`，约 242–291 行）
- Modify: `packages/server/src/services/assistant/prompt.ts`（第 46 行、第 77 行）
- Test: `packages/server/tests/assistantTools.test.ts`

**Interfaces:**
- Consumes: `ASSISTANT_TEXT_MAX`（8000）、`userMessageText`、`deps.runner.getMessages`
- Produces: 同一工具名。参数增加可选 `before: string`。每个会话的返回值变为 `{ messages: Array<{ id?: string; role: string; text: string; truncated?: true }>; omitted: number }`

- [x] **Step 1: 写失败测试**

把 `assistantTools.test.ts` 里现有的 `getMessages` 换成带 id 的三条，并改断言。现有假数据是一条 `完整结论` + 9000 个「你」、没有 id。换成：

```ts
getMessages: async () => [
  {
    id: "m1",
    role: "assistant",
    blocks: [{ type: "text", content: "更早的结论" }],
  },
  {
    id: "m2",
    role: "user",
    blocks: [{ type: "text", content: "中间一句" }],
  },
  {
    id: "m3",
    role: "assistant",
    blocks: [{ type: "text", content: `完整结论${"你".repeat(9000)}` }],
  },
],
```

原断言：

```ts
expect(read.planning[0]?.role).toBe("assistant");
expect(read.planning[0]?.text.startsWith("完整结论")).toBe(true);
expect([...read.planning[0]!.text].length).toBeGreaterThan(8000);
```

改为：

```ts
const read = JSON.parse(full.content) as {
  planning: {
    messages: Array<{ id?: string; role: string; text: string; truncated?: boolean }>;
    omitted: number;
  };
};
expect(read.planning.omitted).toBe(2);
expect(read.planning.messages).toHaveLength(1);
expect(read.planning.messages[0]?.id).toBe("m3");
expect(read.planning.messages[0]?.truncated).toBe(true);
expect([...(read.planning.messages[0]?.text ?? "")].length).toBe(8000);
expect(read.planning.messages[0]?.text.startsWith("完整结论")).toBe(false);

const older = await tool(tools, "ReadSessionMessages").execute(
  { issueId: issue.id, before: "m3" },
  context,
);
const olderBody = JSON.parse(older.content) as {
  planning: { messages: Array<{ id?: string; text: string }>; omitted: number };
};
expect(olderBody.planning.omitted).toBe(0);
expect(olderBody.planning.messages.map((line) => line.id)).toEqual(["m1", "m2"]);
expect(olderBody.planning.messages[0]?.text).toBe("更早的结论");
```

`before: "m3"` 时窗口里只有两条短消息，合计远小于 8000，所以 `omitted` 为 0，两条都在。

- [x] **Step 2: 跑测试，确认失败**

Run: `npx vitest run tests/assistantTools.test.ts`（cwd: `packages/server`）

Expected: FAIL，`planning` 仍是数组，或单条正文长度大于 8000。

- [x] **Step 3: 实现窗口**

在 `messageTools.ts` 的 `ReadSessionMessages` 附近增加：

```ts
type SessionWindowLine = {
  id?: string;
  role: string;
  text: string;
  truncated?: true;
};

function windowSessionLines(
  messages: unknown[],
  before?: string,
): { messages: SessionWindowLine[]; omitted: number } {
  const lines: SessionWindowLine[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: string }).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = userMessageText(message);
    if (!content) continue;
    const id = (message as { id?: string }).id;
    lines.push({
      ...(typeof id === "string" && id ? { id } : {}),
      role,
      text: content,
    });
  }

  let end = lines.length;
  if (before) {
    const index = lines.findIndex((line) => line.id === before);
    if (index >= 0) end = index;
  }

  const selected: SessionWindowLine[] = [];
  let used = 0;
  let oldest = end;
  for (let i = end - 1; i >= 0; i--) {
    const line = lines[i]!;
    const room = ASSISTANT_TEXT_MAX - used;
    if (room <= 0) break;
    const chars = [...line.text];
    if (chars.length <= room) {
      selected.push(line);
      used += chars.length;
      oldest = i;
      continue;
    }
    if (selected.length === 0) {
      selected.push({
        ...(line.id ? { id: line.id } : {}),
        role: line.role,
        text: chars.slice(chars.length - room).join(""),
        truncated: true,
      });
      oldest = i;
    }
    break;
  }
  selected.reverse();
  return { messages: selected, omitted: oldest };
}
```

`readTexts` 改为调用 `windowSessionLines(messages, before)`。`before` 从 `text(args.before)` 读取。工具参数 schema 加上 `before: { type: "string" }`。

工具描述改为：

```ts
"查看 Issue 或自动化运行对应会话的最近消息。一次最多 8000 字，超长的最新一条只保留结尾。omitted 大于 0 表示前面还有消息，把本页最早一条的 id 作为 before 再查。issueId 与 runId 至少给一个。"
```

`prompt.ts` 第 46 行和第 77 行里「拿到完整内容后再判断」改为：

```ts
先用 `ReadSessionMessages` 看该会话最近一段。`omitted` 大于 0 表示前面还有消息，把本页最早一条的 id 作为 `before` 再查。单次正文不超过 8000 字。看完再判断。
```

两处各保持自己的前半句（`request` / `summary` 的 Note 说明不改）。

- [x] **Step 4: 跑测试，确认通过**

Run: `npx vitest run tests/assistantTools.test.ts tests/assistantSession.test.ts`（cwd: `packages/server`）

Expected: PASS。`assistantSession.test.ts` 锁着提示词里的若干句子，本次改动的两句不在那些断言里；若它因提示词全文断言失败，把新句子补进对应断言，不要放宽已有句子。

- [x] **Step 5: Commit**

```bash
git add packages/server/src/services/assistant/tools/messageTools.ts packages/server/src/services/assistant/prompt.ts packages/server/tests/assistantTools.test.ts
git commit -m "$(cat <<'EOF'
fix: return a bounded window from ReadSessionMessages

The tool used to copy an entire other session into the assistant transcript, and compaction kept that copy in the last two rounds. Each call now returns the newest text within 8000 characters and says how many older messages remain.

EOF
)"
```
