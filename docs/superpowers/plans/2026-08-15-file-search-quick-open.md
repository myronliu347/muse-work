# File Content Search + Quick Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File 面板右侧支持「文件树 / 内容搜索」互斥切换（大小写、整词、正则）；会话页 ⌘P/Ctrl+P 按文件名模糊打开到 File 面板。

**Architecture:** Host 在 `fileSearch.ts` 新增 `searchContentInWorkspace`（Node 文本扫描 + 与树相同的 gitignore），经 `workdirHost` IPC 暴露。Webview 在 `panelGroupStore` 按 workdir 记住侧栏模式与搜索态；`FileContentSearch` 渲染结果；`QuickOpenPalette` 复用 `searchWorkspaceFiles`（gitignore + 仅文件）。快捷键在 `panelShortcuts` 与 `ChatApp` 会话页注册。

**Tech Stack:** pnpm monorepo、React 18、Zustand、`ignore`、Vitest + Testing Library、Electron webview IPC

**Spec:** `docs/superpowers/specs/2026-08-15-file-search-quick-open-design.md`

## Global Constraints

- 内容搜索位置：File 右侧栏，与树互斥；顶栏 tree/search icon 切换；模式按 workdir 记忆
- 开关：`caseSensitive` / `wholeWord` / `regex`（一期全做）
- Host：Node 扫描，不用 ripgrep；gitignore 与文件树一致（repo root 为止）
- 封顶：单文件 ≤ 1MB；最多访问 5000 文件；最多 2000 命中；跳过含 NUL 的二进制
- ⌘P：仅非 draft 会话页；Mac ⌘P / Win Ctrl+P（不带 Shift，不与 ⇧⌘P Preview 冲突）
- 打开：`tryOpenPanel("file")` + `openFile`；内容搜索带 `startLine`
- 空 query：内容搜索不请求；⌘P 列表为空（无「最近文件」）
- 换 workdir：侧栏回 `tree`，清空搜索结果
- 防抖：250ms；忽略过期 `requestId`
- 持久化：仅内存
- 包管理器：pnpm；验证：`pnpm -F @muse-work/desktop test` + `pnpm -F @muse-work/webview test` + type-check

## File Structure

```text
packages/desktop/src/main/fileSearch.ts              # + searchContentInWorkspace；可选 gitignore 于文件名搜索
packages/desktop/src/main/workdirHost.ts             # desktopSearchContent IPC
packages/desktop/tests/fileSearch.test.ts            # 内容搜索测试
packages/desktop/tests/workdirHost.test.ts           # IPC 测试

packages/webview/src/types/index.ts                  # ContentSearch* 类型；Panel 消息
packages/webview/src/stores/panelGroupStore.ts       # fileSidebarMode + contentSearch
packages/webview/src/muse/panelShortcuts.ts          # matchQuickOpenShortcut
packages/webview/src/components/panels/FileContentSearch.tsx
packages/webview/src/components/panels/FileTree.tsx   # 模式切换按钮 + 条件渲染
packages/webview/src/components/panels/FilePane.tsx   # 透传搜索 props
packages/webview/src/components/panels/QuickOpenPalette.tsx
packages/webview/src/styles/FilePane.css             # 搜索 / quick-open 样式
packages/webview/src/components/ChatApp.tsx          # IPC、防抖、⌘P、接线
packages/webview/tests/muse/panelShortcuts.test.ts
packages/webview/tests/stores/contentSearchState.test.ts
packages/webview/tests/components/fileContentSearch.test.tsx
packages/webview/tests/components/quickOpenPalette.test.tsx
```

---

### Task 1: Host — `searchContentInWorkspace`

**Files:**
- Modify: `packages/desktop/src/main/fileSearch.ts`
- Modify: `packages/desktop/tests/fileSearch.test.ts`

**Interfaces — Produces:**
```ts
export type ContentSearchMatch = {
  line: number; // 1-based
  text: string;
  startCol: number; // 0-based
  endCol: number;
};
export type ContentSearchFileHit = {
  path: string;
  relativePath: string;
  matches: ContentSearchMatch[];
};
export type SearchContentOptions = {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxFiles?: number;   // default 5000
  maxMatches?: number; // default 2000
  maxFileBytes?: number; // default 1_048_576
};
export type SearchContentResult = {
  results: ContentSearchFileHit[];
  totalMatches: number;
  truncated?: boolean;
  error?: string;
};
export function searchContentInWorkspace(
  workdir: string,
  options: SearchContentOptions,
): SearchContentResult;
```

Also extend file-name search for Quick Open:

```ts
export type SearchWorkspaceFilesOptions = {
  query?: string;
  maxResults?: number;
  maxVisit?: number;
  respectGitignore?: boolean; // default false (keep @ mention behavior)
  filesOnly?: boolean;        // default false
};
```

- [ ] **Step 1: Write failing tests**

在 `packages/desktop/tests/fileSearch.test.ts` 追加：

```ts
import { searchContentInWorkspace } from "../src/main/fileSearch.js";

describe("searchContentInWorkspace", () => {
  it("finds case-sensitive and insensitive matches", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "Foo\nfoo\n");
    const insensitive = searchContentInWorkspace(root, {
      query: "Foo",
      caseSensitive: false,
    });
    expect(insensitive.totalMatches).toBe(2);
    const sensitive = searchContentInWorkspace(root, {
      query: "Foo",
      caseSensitive: true,
    });
    expect(sensitive.totalMatches).toBe(1);
    expect(sensitive.results[0].matches[0].line).toBe(1);
  });

  it("supports wholeWord and regex", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "foo foobar\n");
    const whole = searchContentInWorkspace(root, {
      query: "foo",
      wholeWord: true,
    });
    expect(whole.totalMatches).toBe(1);
    expect(whole.results[0].matches[0].startCol).toBe(0);
    const re = searchContentInWorkspace(root, {
      query: "foo+",
      regex: true,
    });
    expect(re.totalMatches).toBeGreaterThanOrEqual(1);
  });

  it("returns error for invalid regex without throwing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "x\n");
    const out = searchContentInWorkspace(root, {
      query: "(",
      regex: true,
    });
    expect(out.error).toBeTruthy();
    expect(out.results).toEqual([]);
  });

  it("respects gitignore and skips binary / oversize", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, ".gitignore"), "secret.ts\n");
    fs.writeFileSync(path.join(root, "secret.ts"), "needle\n");
    fs.writeFileSync(path.join(root, "ok.ts"), "needle\n");
    fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    const out = searchContentInWorkspace(root, { query: "needle" });
    expect(out.results.map((r) => r.relativePath)).toEqual(["ok.ts"]);
  });

  it("sets truncated when maxMatches exceeded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-cs-"));
    fs.writeFileSync(path.join(root, "a.ts"), "x\nx\nx\n");
    const out = searchContentInWorkspace(root, {
      query: "x",
      maxMatches: 2,
    });
    expect(out.truncated).toBe(true);
    expect(out.totalMatches).toBe(2);
  });
});

describe("searchWorkspaceFiles gitignore + filesOnly", () => {
  it("hides gitignored files when respectGitignore is true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sf-"));
    fs.writeFileSync(path.join(root, ".gitignore"), "hidden.ts\n");
    fs.writeFileSync(path.join(root, "hidden.ts"), "");
    fs.writeFileSync(path.join(root, "visible.ts"), "");
    const hits = searchWorkspaceFiles(root, {
      query: "ts",
      respectGitignore: true,
      filesOnly: true,
    });
    expect(hits.map((h) => h.name).sort()).toEqual(["visible.ts"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/fileSearch.test.ts`
Expected: FAIL — `searchContentInWorkspace` not exported / options unknown

- [ ] **Step 3: Implement**

在 `fileSearch.ts`：

1. 抽出可复用 walk 辅助（或在 `searchContentInWorkspace` 内 walk），调用已有 `loadIgnoreFilter`。
2. `buildMatcher(options)`：
   - `regex: true` → `new RegExp(query, caseSensitive ? "g" : "gi")`，catch → `{ error }`
   - 否则 escape 字面量；`wholeWord` 时包 `\b...\b`（仅非 regex）
   - `regex + wholeWord`：不自动加 `\b`（用户自写）
3. 对每个文件：`stat`；`size > maxFileBytes` skip；读 buffer；前 8KB 含 `0` skip；按行 `RegExp.exec` / 逐行 match，记录 `line/text/startCol/endCol`；`text` 单行超过 400 字符则截断并夹住列。
4. 空 `query.trim()` → `{ results: [], totalMatches: 0 }`。
5. `searchWorkspaceFiles`：当 `respectGitignore`，跳过 `ig.ignores(rel)`；当 `filesOnly`，不把 directory 加入 hits（仍 recurse）。

关键实现骨架：

```ts
export function searchContentInWorkspace(
  workdir: string,
  options: SearchContentOptions,
): SearchContentResult {
  const query = (options.query ?? "").trim();
  if (!query || !workdir || !fs.existsSync(workdir)) {
    return { results: [], totalMatches: 0 };
  }
  const maxFiles = options.maxFiles ?? 5000;
  const maxMatches = options.maxMatches ?? 2000;
  const maxFileBytes = options.maxFileBytes ?? 1 * 1024 * 1024;
  // build RegExp; on throw return { results: [], totalMatches: 0, error: message }
  // walk with loadIgnoreFilter(workdirAbs); count filesVisited; stop on caps
  // return { results, totalMatches, truncated? }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/fileSearch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/fileSearch.ts packages/desktop/tests/fileSearch.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): add workspace content search

EOF
)"
```

---

### Task 2: Host — `desktopSearchContent` IPC

**Files:**
- Modify: `packages/desktop/src/main/workdirHost.ts`
- Modify: `packages/desktop/tests/workdirHost.test.ts`

**Interfaces — Consumes:** `searchContentInWorkspace`  
**Produces:** webview messages `desktopSearchContent` → `desktopSearchContentResult`

- [ ] **Step 1: Write failing IPC test**

在 `workdirHost.test.ts` 仿 `desktopListDir` 用例：

```ts
it("desktopSearchContent replies with matches", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ipc-cs-"));
  fs.writeFileSync(path.join(root, "a.ts"), "hello world\n");
  // mount host with workdir = root (follow existing harness)
  await handleMessage({
    command: "desktopSearchContent",
    requestId: "cs1",
    workdir: root,
    query: "hello",
    caseSensitive: false,
  });
  expect(lastPush).toMatchObject({
    command: "desktopSearchContentResult",
    requestId: "cs1",
    totalMatches: 1,
  });
  expect(lastPush.results[0].relativePath).toBe("a.ts");
});
```

（按现有 `workdirHost.test.ts` 的 `pushToWebview` / harness 写法对齐，勿另起一套。）

- [ ] **Step 2: Run test — expect FAIL**（未知 command 无回复）

- [ ] **Step 3: Wire handler**（紧挨 `desktopListDir`）：

```ts
if (command === "desktopSearchContent") {
  const requestId =
    typeof msg.requestId === "string" ? msg.requestId : "";
  const cwd =
    (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
  const query = typeof msg.query === "string" ? msg.query : "";
  const out = cwd
    ? searchContentInWorkspace(cwd, {
        query,
        caseSensitive: Boolean(msg.caseSensitive),
        wholeWord: Boolean(msg.wholeWord),
        regex: Boolean(msg.regex),
      })
    : { results: [], totalMatches: 0 };
  pushToWebview(win, {
    command: "desktopSearchContentResult",
    requestId,
    results: out.results,
    totalMatches: out.totalMatches,
    truncated: out.truncated,
    error: out.error,
  });
  return;
}
```

Import `searchContentInWorkspace` from `./fileSearch.js`.

- [ ] **Step 4: Run** `pnpm -F @muse-work/desktop exec vitest run tests/workdirHost.test.ts` — PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/workdirHost.ts packages/desktop/tests/workdirHost.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): wire desktopSearchContent IPC

EOF
)"
```

---

### Task 3: Webview types + panel group state

**Files:**
- Modify: `packages/webview/src/types/index.ts`
- Modify: `packages/webview/src/stores/panelGroupStore.ts`
- Modify: `packages/webview/src/stores/index.ts`（如需 re-export）
- Create: `packages/webview/tests/stores/contentSearchState.test.ts`

**Interfaces — Produces:**

```ts
export type FileSidebarMode = "tree" | "search";

export type ContentSearchMatch = {
  line: number;
  text: string;
  startCol: number;
  endCol: number;
};

export type ContentSearchFileHit = {
  path: string;
  relativePath: string;
  matches: ContentSearchMatch[];
};

export type ContentSearchState = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  results: ContentSearchFileHit[];
  expandedFiles: string[];
  loading: boolean;
  error?: string;
  truncated?: boolean;
  requestId?: string;
};
```

`PanelGroupState` 增加：
- `fileSidebarMode: FileSidebarMode`
- `contentSearch: ContentSearchState`

- [ ] **Step 1: Write failing store tests**

```ts
import {
  emptyPanelGroup,
  emptyContentSearchState,
} from "../../src/stores/panelGroupStore";

describe("content search panel state", () => {
  it("emptyPanelGroup defaults to tree mode and empty search", () => {
    const g = emptyPanelGroup();
    expect(g.fileSidebarMode).toBe("tree");
    expect(g.contentSearch).toEqual(emptyContentSearchState());
  });

  it("resolvePanelGroup backfills missing fields", () => {
    // patch resolvePanelGroup similarly to fileTree back-compat
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement helpers**

```ts
export function emptyContentSearchState(): ContentSearchState {
  return {
    query: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    results: [],
    expandedFiles: [],
    loading: false,
  };
}
```

在 `emptyPanelGroup` 设置 `fileSidebarMode: "tree"`、`contentSearch: emptyContentSearchState()`。  
在 `resolvePanelGroup` 对缺失字段 backfill（与 `fileTree` 相同模式）。

- [ ] **Step 4: Run** `pnpm -F @muse-work/webview exec vitest run tests/stores/contentSearchState.test.ts` — PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/types/index.ts packages/webview/src/stores/panelGroupStore.ts packages/webview/src/stores/index.ts packages/webview/tests/stores/contentSearchState.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add file sidebar search state

EOF
)"
```

---

### Task 4: `FileContentSearch` UI

**Files:**
- Create: `packages/webview/src/components/panels/FileContentSearch.tsx`
- Modify: `packages/webview/src/styles/FilePane.css`
- Create: `packages/webview/tests/components/fileContentSearch.test.tsx`

**Interfaces — Consumes:** `ContentSearchState`  
**Produces:** callbacks

```ts
export type FileContentSearchProps = {
  workdir: string | undefined;
  state: ContentSearchState;
  onStateChange: (next: ContentSearchState) => void;
  onOpenMatch: (absPath: string, line: number) => void;
};
```

- [ ] **Step 1: Write failing component tests**

```tsx
it("toggles case/word/regex and updates state", () => {
  const onStateChange = vi.fn();
  render(
    <FileContentSearch
      workdir="/w"
      state={{ ...emptyContentSearchState(), query: "foo" }}
      onStateChange={onStateChange}
      onOpenMatch={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId("content-search-case"));
  expect(onStateChange).toHaveBeenCalledWith(
    expect.objectContaining({ caseSensitive: true }),
  );
});

it("expands file and opens match line", () => {
  const onOpenMatch = vi.fn();
  const onStateChange = vi.fn();
  const state: ContentSearchState = {
    ...emptyContentSearchState(),
    query: "hi",
    results: [
      {
        path: "/w/a.ts",
        relativePath: "a.ts",
        matches: [{ line: 3, text: "hi there", startCol: 0, endCol: 2 }],
      },
    ],
    expandedFiles: ["a.ts"],
  };
  render(
    <FileContentSearch
      workdir="/w"
      state={state}
      onStateChange={onStateChange}
      onOpenMatch={onOpenMatch}
    />,
  );
  fireEvent.click(screen.getByTestId("content-search-match-a.ts-3"));
  expect(onOpenMatch).toHaveBeenCalledWith("/w/a.ts", 3);
});
```

- [ ] **Step 2: Run — FAIL**（模块不存在）

- [ ] **Step 3: Implement UI**

布局：
1. Input `data-testid="content-search-input"` — `onChange` 只改 `query`（请求由父层防抖）
2. 三按钮：`content-search-case` / `content-search-word` / `content-search-regex`，`aria-pressed`
3. 状态行：`loading` →「搜索中…」；`error`；否则 `N results in M files`；`truncated` 附加「（已截断）」
4. 无 workdir →「选择工作目录后搜索」
5. 空 query 且无结果 → 简短提示
6. 文件组：点击 header toggle `expandedFiles`；展开后列出命中行；行内用 `<mark>` 包 `startCol..endCol`
7. 宽度由外层 `FileTree`/`sidebar` 容器控制（本组件 `flex:1; overflow:auto`）

CSS 类前缀：`.file-content-search*`，复用 `--vscode-*` / 现有 FilePane 变量，避免新色板。

- [ ] **Step 4: Run** `pnpm -F @muse-work/webview exec vitest run tests/components/fileContentSearch.test.tsx` — PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/FileContentSearch.tsx packages/webview/src/styles/FilePane.css packages/webview/tests/components/fileContentSearch.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): add FileContentSearch panel UI

EOF
)"
```

---

### Task 5: 侧栏模式切换接入 `FileTree` / `FilePane`

**Files:**
- Modify: `packages/webview/src/components/panels/FileTree.tsx`
- Modify: `packages/webview/src/components/panels/FilePane.tsx`
- Modify: `packages/webview/tests/components/fileTree.test.tsx`
- Modify: `packages/webview/tests/components/filePane.test.tsx`（如需）

**Interfaces — Extends FileTreeProps:**

```ts
sidebarMode?: FileSidebarMode; // default "tree"
onSidebarModeChange?: (mode: FileSidebarMode) => void;
contentSearch?: ContentSearchState;
onContentSearchChange?: (next: ContentSearchState) => void;
onOpenMatch?: (absPath: string, line: number) => void;
```

- [ ] **Step 1: Write failing tests**

```tsx
it("switches between tree and search modes", () => {
  const onMode = vi.fn();
  render(
    <FileTree
      workdir="/w"
      vscode={{ postMessage: vi.fn() }}
      tree={emptyFileTreeState()}
      onTreeChange={vi.fn()}
      onOpenFile={vi.fn()}
      sidebarMode="tree"
      onSidebarModeChange={onMode}
      contentSearch={emptyContentSearchState()}
      onContentSearchChange={vi.fn()}
      onOpenMatch={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId("file-sidebar-mode-search"));
  expect(onMode).toHaveBeenCalledWith("search");
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

Header 右侧增加两个 icon 按钮：
- `file-sidebar-mode-tree` → `codicon-list-tree`（或 `codicon-files`）
- `file-sidebar-mode-search` → `codicon-search`
- `aria-pressed` 反映当前 mode；仅当 `onSidebarModeChange` 存在时显示

`sidebarMode === "search"` 时不渲染虚拟树，改为：

```tsx
<FileContentSearch
  workdir={workdir}
  state={contentSearch!}
  onStateChange={onContentSearchChange!}
  onOpenMatch={onOpenMatch!}
/>
```

`FilePane` 透传上述 props；`onOpenMatch` → `onOpenFile(path, line)`。

- [ ] **Step 4: Run** fileTree + filePane tests — PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/FileTree.tsx packages/webview/src/components/panels/FilePane.tsx packages/webview/tests/components/fileTree.test.tsx packages/webview/tests/components/filePane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): toggle file sidebar tree and search

EOF
)"
```

---

### Task 6: ChatApp — 内容搜索请求 / 响应 / workdir 切换

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/src/types/index.ts`（若消息联合类型需登记）

**行为：**

1. 从 `usePanelGroup` 读 `fileSidebarMode`、`contentSearch`；传给 `FilePane`。
2. `onSidebarModeChange` → `patchGroup({ fileSidebarMode })`。
3. `onContentSearchChange` → `patchGroup({ contentSearch })`；若 `query`/`flags` 变化且 `query.trim()` 非空，250ms debounce 后：

```ts
const requestId = `cs-${++seq}`;
postToHost({
  command: "desktopSearchContent",
  requestId,
  workdir: effectiveWorkdir,
  query: next.query,
  caseSensitive: next.caseSensitive,
  wholeWord: next.wholeWord,
  regex: next.regex,
});
// patch loading:true, requestId
```

4. `case "desktopSearchContentResult"`：若 `message.requestId !== group.contentSearch.requestId` 忽略；否则写入 `results/total/truncated/error`，`loading:false`。
5. workdir / `groupKey` 变化时：`fileSidebarMode: "tree"` + `contentSearch: emptyContentSearchState()`（在已有 workdir 切换逻辑旁；勿在每次 render 清空）。
6. 空 query：清 `results`，`loading:false`，不发 IPC。

- [ ] **Step 1:** 若有现成 ChatApp/desktop 集成测，追加一条 mock `desktopSearchContentResult`；否则手测清单写入 Step 4。优先在 `tests/webview/desktopApp.test.tsx` 或新建轻量测：收到 result 后 group 更新。若集成测成本过高，本 task 以手动 checklist + type-check 为准，并在 commit message 注明。

- [ ] **Step 2–3:** 实现接线如上。

- [ ] **Step 4: Verify**

Run: `pnpm -F @muse-work/webview exec tsc -p tsconfig.json --noEmit`（或包内既有 type-check script）  
Manual（desktop）：打开 File → 点搜索 → 输入已知字符串 → 点命中行应打开并带行号。

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx packages/webview/src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(webview): wire content search IPC in ChatApp

EOF
)"
```

---

### Task 7: `matchQuickOpenShortcut` + `QuickOpenPalette`

**Files:**
- Modify: `packages/webview/src/muse/panelShortcuts.ts`
- Modify: `packages/webview/tests/muse/panelShortcuts.test.ts`
- Create: `packages/webview/src/components/panels/QuickOpenPalette.tsx`
- Create: `packages/webview/tests/components/quickOpenPalette.test.tsx`
- Modify: `packages/webview/src/styles/FilePane.css`（或新建 `QuickOpen.css` 并在组件 import）

**Interfaces:**

```ts
export function matchQuickOpenShortcut(event: KeyboardEvent): boolean;
// Mac: meta && !ctrl && !shift && !alt && key===p
// Win/Linux: ctrl && !meta && !shift && !alt && key===p
```

```ts
export type QuickOpenPaletteProps = {
  open: boolean;
  workdir: string | undefined;
  vscode: { postMessage: (msg: unknown) => void };
  onClose: () => void;
  onOpenFile: (absPath: string) => void;
};
```

Quick Open 文件名搜索：组件内 debounce 后 `postMessage`：

```ts
{
  command: "requestFileSuggestions",
  requestId,
  filterText: query,
  dir: "",
  workdir,
  // Host: when filterText non-empty, call
  // searchWorkspaceFiles(cwd, { query, maxResults: 50, respectGitignore: true, filesOnly: true })
}
```

**Host 微调（本 task 内一并做）：** `workdirHost` 的 `requestFileSuggestions` 在 `query` 非空时传入 `maxResults: 50, respectGitignore: true, filesOnly: true`。若担心影响 `@` 提及，改为：仅当 `msg.filesOnly === true` 或 `msg.source === "quickOpen"` 时启用；Quick Open 发送 `source: "quickOpen"`。

推荐：

```ts
// Quick Open postMessage
{ command: "requestFileSuggestions", ..., source: "quickOpen" }

// Host
const isQuickOpen = msg.source === "quickOpen";
searchWorkspaceFiles(cwd, {
  query,
  maxResults: isQuickOpen ? 50 : 20,
  respectGitignore: isQuickOpen,
  filesOnly: isQuickOpen,
});
```

- [ ] **Step 1: Shortcut + palette failing tests**

```ts
it("matches cmd/ctrl+p without shift", () => {
  expect(
    matchQuickOpenShortcut(
      new KeyboardEvent("keydown", { key: "p", metaKey: true }),
    ),
  ).toBe(true); // under mac mock
  expect(
    matchQuickOpenShortcut(
      new KeyboardEvent("keydown", { key: "p", metaKey: true, shiftKey: true }),
    ),
  ).toBe(false);
});
```

```tsx
it("Enter opens selected file and closes", () => {
  // render open palette with mocked suggestions via window message
  // ArrowDown + Enter → onOpenFile + onClose
});

it("empty query shows empty list", () => {
  // no rows
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement palette**

- 居中浮层 + 半透明 backdrop；`data-testid="quick-open"`
- Input autofocus；Esc → `onClose`
- ↑↓ 改 `selectedIndex`；Enter → `onOpenFile(hits[i].path)` + `onClose`
- 点击行同样打开
- 无 workdir：显示「选择工作目录后打开文件」
- 列表项显示 `relativePath` + `FileIcon`
- 监听 `fileSuggestionsResponse`，按 `requestId` 丢弃过期

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/muse/panelShortcuts.ts packages/webview/tests/muse/panelShortcuts.test.ts packages/webview/src/components/panels/QuickOpenPalette.tsx packages/webview/tests/components/quickOpenPalette.test.tsx packages/webview/src/styles/FilePane.css packages/desktop/src/main/workdirHost.ts packages/desktop/tests/workdirHost.test.ts
git commit -m "$(cat <<'EOF'
feat: add Quick Open palette and ⌘P shortcut

EOF
)"
```

---

### Task 8: ChatApp 注册 ⌘P + 回归

**Files:**
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/tests/muse/panelShortcuts.test.ts`（若未覆盖）

**行为：**

在现有 `keydown` capture listener 中，**先于** `matchPanelShortcut`：

```ts
if (
  isDesktop &&
  !isDraftSession &&
  matchQuickOpenShortcut(event)
) {
  event.preventDefault();
  event.stopPropagation();
  setQuickOpenOpen(true);
  return;
}
```

- `isDraftSession === true`（欢迎/新会话页）不打开
- 渲染 `<QuickOpenPalette open={...} workdir={effectiveWorkdir} ... onOpenFile={handleOpenFile} onClose={...} />`
- 确认 ⇧⌘P 仍只 toggle preview（现有测应仍绿）

- [ ] **Step 1:** 如有 desktopApp 快捷键测，断言 draft 不打开、session 打开；否则 manual checklist。

- [ ] **Step 2–3:** 接线如上。

- [ ] **Step 4: Full verify**

```bash
pnpm -F @muse-work/desktop test
pnpm -F @muse-work/webview test
```

Manual：
- [ ] 树 ↔ 搜索切换；换 workdir 回树且结果清空
- [ ] 三开关重搜；非法正则显示 error
- [ ] 点命中行打开 + 行号
- [ ] ⌘P 搜文件名 Enter 打开；Esc 关闭；⇧⌘P 仍是 Preview；⇧⌘F 仍是 File
- [ ] `@` 提及不受 `source: quickOpen` 影响

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/ChatApp.tsx
git commit -m "$(cat <<'EOF'
feat(webview): enable session Quick Open with ⌘P

EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec 要求 | Task |
|-----------|------|
| 侧栏 tree/search 切换 + 记忆 | 3, 5, 6 |
| 大小写 / 整词 / 正则 | 1, 4, 6 |
| Node 扫描 + gitignore + 封顶 | 1 |
| `desktopSearchContent` IPC | 2, 6 |
| 点行 `openFile` + `startLine` | 5, 6 |
| 防抖 + requestId | 6 |
| 换 workdir 重置 | 6 |
| ⌘P 会话页 + 文件名模糊 | 7, 8 |
| 空 query 空列表 | 7 |
| 不碰 ripgrep / replace / 持久化 | 遵守 Global Constraints |

无 TBD 占位；类型名在 Task 1/3 对齐（`ContentSearchFileHit` 等）。
