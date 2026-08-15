# Panel workdir-scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 右侧面板与嵌入终端按 workdir（绝对路径）缓存，同目录切 session 不刷新；换目录再回来可恢复 UI 与 PTY。

**Architecture:** `panelGroupStore` 的 key 从 `sessionId` / `new:paneId` 改为 `effectiveWorkdir` 绝对路径。`TerminalPane` 的 `termId` 改为 `term-wd-${encodeURIComponent(workdir)}`。删除 session 不再 kill PTY；prune 按 tree 中 `session.workdir` 并集裁剪，并对被移除的 workdir kill 对应终端。

**Tech Stack:** pnpm monorepo、React 18、Zustand、Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-08-15-panel-workdir-scope-design.md`

## Global Constraints

- `groupKey` / `termId` 均使用 **绝对路径**（与 `effectiveWorkdir` 相同字符串；仅 `trim`，不另做路径规范化库）
- `desktopSessionTree` 的 **group.workdir 是 `"pin"`/`"recent"`**，prune 只用 **`DesktopSessionEntry.workdir`**
- 无 workdir：不写 panel cache、不创建 PTY
- 不改 chatReducer；不做 SSH / 分屏特判；不持久化到磁盘
- 包管理器：pnpm；验证：`pnpm -F @muse-work/webview test` + `type-check`

## File Structure

```text
packages/webview/src/stores/panelGroupStore.ts     # workdirTermId、prune 返回 removed、弱化 draft/migrate
packages/webview/src/stores/index.ts               # 导出 workdirTermId
packages/webview/src/components/ChatApp.tsx        # groupKey = effectiveWorkdir；删 migrate
packages/webview/src/components/DesktopApp.tsx     # prune by session.workdir；kill removed terms
packages/webview/src/components/panels/TerminalPane.tsx  # termId by workdir；session 切换不重置
packages/webview/src/muse/hostBridge.ts            # 删 deleteSession 的 term-${id} kill
packages/webview/tests/webview/chatAppPanels.test.tsx
packages/webview/tests/webview/terminalPane.test.tsx
docs/superpowers/specs/2026-08-15-panel-workdir-scope-design.md  # 若有未提交澄清，一并提交
```

---

### Task 1: Store helpers — `workdirTermId` + prune 返回 removed keys

**Files:**
- Modify: `packages/webview/src/stores/panelGroupStore.ts`
- Modify: `packages/webview/src/stores/index.ts`
- Create: `packages/webview/tests/stores/panelGroupStore.test.ts`

**Interfaces — Produces:**
- `workdirTermId(workdir: string): string` → `term-wd-${encodeURIComponent(workdir.trim())}`
- `isDraftGroupKey(key)` → 对空/`__draft__`/`new:` 仍 true（兼容调用方），但 ChatApp 将不再用这些当 key
- `pruneGroups(keepKeys): string[]` — 返回被删除的 group keys（绝对路径）
- `prunePanelGroupCache(keepKeys): string[]` — 同上

- [ ] **Step 1: Write failing tests**

```ts
/** @vitest-environment node */
import { describe, it, expect, beforeEach } from "vitest";
import {
  usePanelGroupStore,
  workdirTermId,
  prunePanelGroupCache,
} from "../../src/stores/panelGroupStore";

beforeEach(() => {
  usePanelGroupStore.getState().reset();
});

describe("workdirTermId", () => {
  it("encodes absolute paths", () => {
    expect(workdirTermId("/Users/a/proj")).toBe(
      "term-wd-" + encodeURIComponent("/Users/a/proj"),
    );
  });
});

describe("prunePanelGroupCache", () => {
  it("returns removed workdir keys", () => {
    const store = usePanelGroupStore.getState();
    store.ensureGroup("/work/a");
    store.ensureGroup("/work/b");
    const removed = prunePanelGroupCache(new Set(["/work/a"]));
    expect(removed).toEqual(["/work/b"]);
    expect(Object.keys(usePanelGroupStore.getState().groups)).toEqual([
      "/work/a",
    ]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm -F @muse-work/webview test -- tests/stores/panelGroupStore.test.ts
```

- [ ] **Step 3: Implement**

在 `panelGroupStore.ts` 增加：

```ts
export function workdirTermId(workdir: string): string {
  return `term-wd-${encodeURIComponent(workdir.trim())}`;
}
```

改 `pruneGroups` / `prunePanelGroupCache` 返回 `string[]`（removed keys）。`migrateGroup` 可保留实现供过渡，但后续 Task 不再调用。

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm -F @muse-work/webview test -- tests/stores/panelGroupStore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/stores/panelGroupStore.ts packages/webview/src/stores/index.ts packages/webview/tests/stores/panelGroupStore.test.ts docs/superpowers/specs/2026-08-15-panel-workdir-scope-design.md
git commit -m "$(cat <<'EOF'
feat(webview): workdir term id helper and prune removed keys

EOF
)"
```

---

### Task 2: ChatApp — `groupKey` 改 workdir，删除 session migrate

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/tests/webview/chatAppPanels.test.tsx`（`session-level panel groups` → `workdir-level panel groups`）

**Interfaces — Consumes:** `usePanelGroup(groupKey)`，`groupKey = effectiveWorkdir | undefined`  
**Produces:** 同 workdir 切 session 面板状态不变

- [ ] **Step 1: Rewrite failing tests**（替换整个 `describe("session-level panel groups")`）

要点（fixtures 的 session entry **必须带** `workdir` 绝对路径）：

```ts
describe("workdir-level panel groups", () => {
  const session = (sessionId: string, workdir = "/work/a") => ({
    sessionId,
    title: sessionId,
    lastActiveAt: Date.now(),
    hasWorktree: false,
    workdir,
  });

  it("same workdir session switch keeps the panel group", () => {
    // open diff on s1 @ /work/a → switch to s2 @ /work/a → diff still open
  });

  it("switching workdir swaps the panel group; switching back restores", () => {
    // s1 @ /work/a opens diff; switch to s2 @ /work/b → empty;
    // open terminal on b; back to a → diff restored
    //（通过 desktopWorkdirState + updateSession/currentSession 或现有 host 消息切换）
  });

  it("panels bind to workdir even before a session id exists", () => {
    // draft/new with workdir /work/a: open diff; bind s1 same workdir → still open
  });

  it("prunes panel group when workdir leaves the session tree", () => {
    // open on /work/a; remove all /work/a sessions from tree + switch away;
    // prune should drop /work/a（配合 DesktopApp prune；本用例可只断言 tree 更新后行为）
  });
});
```

删除或改写旧用例：

- `switching sessions swaps the panel group…`（同目录不再 swap）
- `new-session bucket migrates…`
- `new-session bucket does not leak…`
- `a deleted session forgets its panel group`（删 session 不清 panel；改成「workdir 从 tree 消失才 prune」）

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm -F @muse-work/webview test -- tests/webview/chatAppPanels.test.tsx -t "workdir-level"
```

- [ ] **Step 3: Implement ChatApp groupKey**

替换现有 session/`new:`/`__draft__` key 逻辑为：

```ts
const groupKey =
  isDesktop && effectiveWorkdir ? effectiveWorkdir : undefined;
```

删除：

- `boundSessionId` / `singlePaneSessionId` 对 groupKey 的贡献
- `sentFromNewSessionRef` + `migrateGroup` effect
- `updatePanelGroup` / listener 里对 `isDraftGroupKey` 的 session 桶判断（无 `groupKey` 即不写）

`panelDisabled`：

```ts
if (!isDesktop) return [];
if (!effectiveWorkdir) return [...PANEL_ORDER]; // 无目录：全部禁用
return []; // 有目录：均可开（preview/diff/terminal/file）
```

（去掉 `isDraftSession` / `__draft__` / `new:` 对禁用列表的特殊分支；与 spec「按有无 workdir」一致。）

- [ ] **Step 4: Run panel tests**

```bash
pnpm -F @muse-work/webview test -- tests/webview/chatAppPanels.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx packages/webview/tests/webview/chatAppPanels.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): key desktop panels by workdir

EOF
)"
```

---

### Task 3: DesktopApp prune by `session.workdir` + kill removed PTYs

**Files:**
- Modify: `packages/webview/src/components/DesktopApp.tsx`

**Interfaces — Consumes:** `prunePanelGroupCache(keep): string[]`，`workdirTermId`  
**Produces:** tree/workdir 更新后只保留仍出现的绝对路径；对被删 key post `desktopTerminalKill`

- [ ] **Step 1: Replace `prunePanels`**

```ts
const prunePanels = () => {
  const keep = new Set<string>();
  const wd = panesRef.current; // unused for keys
  void wd;
  if (/* current workdir from store/ref */) {
    // workdirState may be in store — read from ref or getState
  }
  // Prefer: keep current workdirState.workdir if set
  for (const g of sessionTreeRef.current) {
    for (const s of g.sessions) {
      if (s.workdir) keep.add(s.workdir);
    }
  }
  // ALSO add desktop workdirState.workdir (from store)
  const removed = prunePanelGroupCache(keep);
  for (const path of removed) {
    vscode.postMessage({
      command: "desktopTerminalKill",
      termId: workdirTermId(path),
    });
  }
};
```

具体读取当前 workdir：用 `useDesktopStore.getState().workdirState?.workdir` 或现有 `workdirState` 闭包/ref（与 `sessionTreeRef` 同样模式，避免 stale）。

**禁止** `keep.add(g.workdir)`（会是 `"pin"`/`"recent"`）。  
**删除** 旧的 `new:${paneId}` / `p.sessionId` keep 逻辑。

- [ ] **Step 2: Ensure chatAppPanels prune 用例 PASS**（Task 2 里「workdir leaves tree」）

```bash
pnpm -F @muse-work/webview test -- tests/webview/chatAppPanels.test.tsx -t "workdir-level"
```

- [ ] **Step 3: Commit**

```bash
git add packages/webview/src/components/DesktopApp.tsx
git commit -m "$(cat <<'EOF'
feat(webview): prune panel cache by session workdir

EOF
)"
```

---

### Task 4: TerminalPane — workdir-scoped `termId`

**Files:**
- Modify: `packages/webview/src/components/panels/TerminalPane.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`（传 props）
- Modify: `packages/webview/tests/webview/terminalPane.test.tsx`

**Interfaces — Consumes:** `workdirTermId(workdir)`  
**Produces:** 同 workdir 切 session 零 create/kill/reset

- [ ] **Step 1: Rewrite terminal tests**

```ts
it("uses term-wd encoded workdir as termId", async () => {
  const { vscode } = renderPane({ workdir: "/w/a", sessionId: "s1" });
  await act(async () => {});
  expect(postsOf(vscode, "desktopTerminalCreate")[0]).toMatchObject({
    termId: "term-wd-" + encodeURIComponent("/w/a"),
    workdir: "/w/a",
  });
});

it("same workdir session switch does not reset or recreate PTY", async () => {
  const { vscode, rerenderWith } = renderPane({
    sessionId: "s1",
    workdir: "/w/a",
  });
  await act(async () => {});
  rerenderWith({ sessionId: "s2", workdir: "/w/a" });
  expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(0);
  expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
  expect(mockTerminals[0].resetCount).toBe(0);
});

it("workdir switch reattaches a different PTY without killing the old one", async () => {
  const { vscode, rerenderWith } = renderPane({
    sessionId: "s1",
    workdir: "/w/a",
  });
  await act(async () => {});
  rerenderWith({ sessionId: "s1", workdir: "/w/b" });
  expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(0);
  expect(postsOf(vscode, "desktopTerminalCreate")).toEqual([
    expect.objectContaining({
      termId: "term-wd-" + encodeURIComponent("/w/a"),
    }),
    expect.objectContaining({
      termId: "term-wd-" + encodeURIComponent("/w/b"),
      workdir: "/w/b",
    }),
  ]);
});

it("does not create a PTY without workdir", async () => {
  const { vscode } = renderPane({ workdir: undefined, sessionId: "__draft__" });
  await act(async () => {});
  expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(0);
});
```

更新旧用例：`term-pane-1` / `term-main` / `term-s1` 全部改为 workdir 编码；`renderPane` 默认提供 `workdir: "/tmp/work"`。

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm -F @muse-work/webview test -- tests/webview/terminalPane.test.tsx
```

- [ ] **Step 3: Implement TerminalPane**

```ts
const termId = workdir ? workdirTermId(workdir) : `term-${paneId ?? "main"}`;
// createPty: if (!workdir) return;
```

可见性 effect：

- 依赖改为 `[visible, termId, workdir, …]`（或由 `termId` 变化代表 workdir 切换）
- **不要**再因 `sessionId` 变化 reset/create
- `termId` 变化：reset UI + create（不 kill 旧 id）
- 同 `termId` 下 `workdir` 字符串变化（极少）：kill + recreate（保留旧语义）

`ChatApp` 渲染：

```tsx
<TerminalPane
  vscode={vscode}
  paneId={paneId}
  visible={checkedPanels.includes("terminal")}
  workdir={effectiveWorkdir}
  onOpenPreview={openPreviewHandler}
  {...common}
/>
```

可删除 `sessionId` prop（若仍保留则忽略，不参与 termId）。

- [ ] **Step 4: Run terminal + type-check**

```bash
pnpm -F @muse-work/webview test -- tests/webview/terminalPane.test.tsx
pnpm -F @muse-work/webview type-check
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/TerminalPane.tsx packages/webview/src/components/ChatApp.tsx packages/webview/tests/webview/terminalPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): scope embedded terminal PTY by workdir

EOF
)"
```

---

### Task 5: hostBridge — 删除 session 时不再 kill PTY

**Files:**
- Modify: `packages/webview/src/muse/hostBridge.ts`
- Modify: 若有断言 `desktopTerminalKill` + `term-${id}` 的测试则改掉（当前 `tests/muse` 未见；搜全仓确认）

- [ ] **Step 1: Remove kill in `handleDeleteSession`**

删除：

```ts
opts.outer?.postMessage({
  command: "desktopTerminalKill",
  termId: `term-${id}`,
});
```

- [ ] **Step 2: Grep 确认无残留 session-term kill**

```bash
rg 'term-\$\{|desktopTerminalKill' packages/webview/src packages/webview/tests
```

- [ ] **Step 3: Full webview test + type-check**

```bash
pnpm -F @muse-work/webview type-check
pnpm -F @muse-work/webview test
```

- [ ] **Step 4: Commit**

```bash
git add packages/webview/src/muse/hostBridge.ts packages/webview/tests
git commit -m "$(cat <<'EOF'
fix(webview): keep workdir PTY alive when deleting a session

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| groupKey = 绝对路径 workdir | Task 2 |
| 无 workdir 不写 cache | Task 2 |
| 删 migrate / draft bucket | Task 2 |
| termId = term-wd-encode | Task 1 + 4 |
| 同 workdir 切 session 不刷新终端 | Task 4 |
| 换 workdir 保留旧 PTY | Task 4 |
| 删 session 不 kill | Task 5 |
| prune by session.workdir + kill removed | Task 1 + 3 |
| 测试语义更新 | Task 2 + 4 |

## Self-review notes

- 无 TBD/placeholder
- `workdirTermId` 在 Task 1 定义，Task 3/4/5 一致使用
- prune **绝不**使用 `group.workdir`（pin/recent）
- remote preview 测试若仍假设 session 级 panel，按同 workdir 共享改断言（Task 2 全文件跑一遍时修）
