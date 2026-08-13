# @ 提及：目录钻入 + 全局搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入 `@` 后可一层层浏览工作区目录，打字后切成全局模糊搜索（名称在左、路径在右），选中后仍插入现有 `[@file:…]` 标签。

**Architecture:** 浏览路径是弹层内部状态 `browsePath`，不写进输入框。空 `filterText` 时 webview 带 `dir` 请求当前层直接子项；有 filter 时省略 `dir`、全库搜索。桌面 `workdirHost` 按 query 是否为空分别调用 `listWorkspaceDir` / `searchWorkspaceFiles`。键盘与请求 payload 抽到 webview 纯函数，避免在 contenteditable 里测交互。

**Tech Stack:** TypeScript、Electron main（`fs`）、React 18、Vitest、Testing Library、jsdom

**Spec:** `docs/superpowers/specs/2026-08-13-file-mention-cascader-design.md`

## Global Constraints

- 插入格式不变：`[@file:src/foo.ts]` / `[@file:src/components/]`（目录 `relativePath` 带尾斜杠）
- `browsePath` 只存在弹层状态，**禁止**写成 `@src/` 之类输入文本
- `filterText === ""` → 浏览；非空 → 搜索。清空 filter 后从**工作区根**再浏览（搜索时丢弃 `browsePath`）
- 忽略规则与 `searchWorkspaceFiles` 相同：`SKIP_DIR_NAMES` + 点开头**目录**；`.DS_Store` 跳过
- `listWorkspaceDir` 不递归；不存在的 `dir` 返回 `[]`
- 不做多列 Finder、不做树展开；本轮不改 IDE/VSCE host
- 新 webview 测试放 `packages/webview/tests/components/**` 或 `tests/muse/**`（vitest **不含** `tests/webview/*`）
- 包管理器：pnpm；测试：Vitest

## File Structure

```text
packages/desktop/src/main/fileSearch.ts
  # + listWorkspaceDir；抽出 toWorkspaceSuggestion
packages/desktop/src/main/workdirHost.ts
  # 空 query + dir → listWorkspaceDir；有 query → search（忽略 dir）
packages/desktop/tests/fileSearch.test.ts
packages/desktop/tests/workdirHost.test.ts
packages/webview/src/utils/fileMentionBrowse.ts
  # parentBrowsePath / payload / 键盘 / 面包屑
packages/webview/src/types/index.ts
  # FileSuggestionDropdownProps：browsePath、onEnterDirectory、onBrowseTo
packages/webview/src/components/FileSuggestionDropdown.tsx
packages/webview/src/styles/FileSuggestionDropdown.css
packages/webview/src/components/MessageInput.tsx
  # browsePath + dir 请求 + 键盘 → ← Backspace
packages/webview/tests/muse/fileMentionBrowse.test.ts
packages/webview/tests/components/fileSuggestionDropdown.test.tsx
```

---

### Task 1: `listWorkspaceDir`（只列当前层）

**Files:**
- Modify: `packages/desktop/src/main/fileSearch.ts`
- Modify: `packages/desktop/tests/fileSearch.test.ts`

**Interfaces:**
- Consumes: 现有 `WorkspaceFileSuggestion`、`isSkippedDir`、`SKIP_DIR_NAMES`
- Produces:
  - `export function listWorkspaceDir(workdir: string, dir?: string): WorkspaceFileSuggestion[]`
  - `dir` 为相对工作区路径，允许 `""` / `"src"` / `"src/"`；目录结果的 `relativePath` 带尾 `/`
  - 含 `..` 的 `dir`、越出 workdir、目标不是目录、workdir 不存在 → `[]`

- [ ] **Step 1: 写失败测试**

在 `packages/desktop/tests/fileSearch.test.ts` 追加（保留现有 `searchWorkspaceFiles` 用例）。先 import `listWorkspaceDir`：

```ts
import {
  listWorkspaceDir,
  searchWorkspaceFiles,
} from "../src/main/fileSearch.js";
```

然后加：

```ts
describe("listWorkspaceDir", () => {
  it("returns only direct children, dirs first, and skips node_modules/.git", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.mkdirSync(path.join(root, "src", "nested"));
    fs.writeFileSync(path.join(root, "README.md"), "");
    fs.writeFileSync(path.join(root, "src", "hello.ts"), "");
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"));

    const rootHits = listWorkspaceDir(root, "");
    expect(rootHits.map((h) => h.name)).toEqual(["src", "README.md"]);
    expect(rootHits[0]).toMatchObject({
      name: "src",
      relativePath: "src/",
      isDirectory: true,
      icon: "codicon-folder",
    });
    expect(rootHits[1]).toMatchObject({
      name: "README.md",
      relativePath: "README.md",
      isDirectory: false,
    });

    const srcHits = listWorkspaceDir(root, "src/");
    expect(srcHits.map((h) => h.relativePath)).toEqual(["src/nested/", "src/hello.ts"]);
    expect(srcHits.some((h) => h.name === "README.md")).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns empty for missing workdir, missing dir, or path traversal", () => {
    expect(listWorkspaceDir("/tmp/muse-does-not-exist-xyz", "")).toEqual([]);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-miss-"));
    fs.mkdirSync(path.join(root, "src"));
    expect(listWorkspaceDir(root, "nope")).toEqual([]);
    expect(listWorkspaceDir(root, "../outside")).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("searchWorkspaceFiles directories", () => {
  it("includes matching directories in results", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-fs-dir-"));
    fs.mkdirSync(path.join(root, "components"));
    fs.writeFileSync(path.join(root, "components", "a.ts"), "");

    const hits = searchWorkspaceFiles(root, { query: "comp" });
    expect(hits.some((h) => h.relativePath === "components/" && h.isDirectory)).toBe(
      true,
    );

    fs.rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/fileSearch.test.ts`

Expected: FAIL，`listWorkspaceDir` is not exported / is not a function

- [ ] **Step 3: 实现 `listWorkspaceDir` 并抽出 `toWorkspaceSuggestion`**

在 `packages/desktop/src/main/fileSearch.ts` 的 `isSkippedDir` 之后加入：

```ts
function toWorkspaceSuggestion(
  abs: string,
  rel: string,
  name: string,
  isDirectory: boolean,
): WorkspaceFileSuggestion {
  const relativePath = isDirectory ? `${rel}/` : rel;
  const extensionMatch = !isDirectory ? name.match(/\.([^.]+)$/) : null;
  return {
    path: abs,
    relativePath,
    name,
    extension: extensionMatch ? extensionMatch[1] : "",
    icon: isDirectory ? "codicon-folder" : "codicon-file",
    isDirectory,
  };
}

/**
 * List direct children of `dir` (relative to workdir). Does not recurse.
 */
export function listWorkspaceDir(
  workdir: string,
  dir = "",
): WorkspaceFileSuggestion[] {
  if (!workdir || !fs.existsSync(workdir)) {
    return [];
  }

  const normalized = dir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (normalized.split("/").some((seg) => seg === ".." || seg === ".")) {
    return [];
  }

  const workdirAbs = path.resolve(workdir);
  const target = normalized
    ? path.resolve(workdirAbs, ...normalized.split("/"))
    : workdirAbs;
  const relToRoot = path.relative(workdirAbs, target);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return [];
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: WorkspaceFileSuggestion[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory() && isSkippedDir(name)) continue;
    if (name === ".DS_Store") continue;
    const rel = normalized ? `${normalized}/${name}` : name;
    const abs = path.join(target, name);
    items.push(toWorkspaceSuggestion(abs, rel, name, entry.isDirectory()));
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}
```

把 `searchWorkspaceFiles` 里构造 hit 的那段换成 `toWorkspaceSuggestion`（保留 `score` 字段）：

```ts
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(absDir, name);
      const isDirectory = entry.isDirectory();
      const relativePath = isDirectory ? `${rel}/` : rel;
      const score = scoreMatch(relativePath, name, query);
      if (score > 0) {
        hits.push({
          ...toWorkspaceSuggestion(abs, rel, name, isDirectory),
          score,
        });
      }
```

- [ ] **Step 4: 再跑测试确认通过**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/fileSearch.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/fileSearch.ts packages/desktop/tests/fileSearch.test.ts
git commit -m "$(cat <<'EOF'
feat: list workspace dir children for @ browse

EOF
)"
```

---

### Task 2: `workdirHost` 空 query 列目录、有 query 忽略 `dir`

**Files:**
- Modify: `packages/desktop/src/main/workdirHost.ts`（`requestFileSuggestions` 分支，约 209–232 行）
- Modify: `packages/desktop/tests/workdirHost.test.ts`

**Interfaces:**
- Consumes: `listWorkspaceDir(workdir, dir)`、`searchWorkspaceFiles(workdir, { query, maxResults: 20 })`
- Produces: webview 消息形状不变（`fileSuggestionsResponse` + `suggestions` + `filterText` + `requestId`）。请求可带可选 `dir: string`

- [ ] **Step 1: 写失败测试**

在 `packages/desktop/tests/workdirHost.test.ts` 现有 `requestFileSuggestions replies with matching workspace files` 用例后面追加两个用例。host 搭建方式与现有用例相同（`installWorkdirHost` + fake `ipc.on` + `TO_WEBVIEW`）。

```ts
  it("requestFileSuggestions with empty filter lists dir children only", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-ls-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-host-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
    fs.writeFileSync(path.join(dir, "src", "hello.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "requestFileSuggestions",
        filterText: "",
        dir: "src",
        requestId: "req-ls",
      },
    );

    const reply = sent.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { command?: string }).command === "fileSuggestionsResponse",
    ) as { suggestions: Array<{ name: string; relativePath: string }> };

    expect(reply.suggestions.map((s) => s.relativePath)).toEqual(["src/hello.ts"]);
    expect(reply.suggestions.some((s) => s.name === "README.md")).toBe(false);

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("requestFileSuggestions with query ignores dir and searches globally", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-q-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-q-host-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "other"));
    fs.writeFileSync(path.join(dir, "src", "hello.ts"), "export {}\n");

    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;

    const fakeWin = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          if (channel === TO_WEBVIEW) sent.push(data);
        },
      },
    };

    const host = installWorkdirHost({
      userDataPath: userData,
      getWindow: () => fakeWin as never,
      defaultWorkdir: dir,
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    });

    await handler!(
      { sender: {} },
      {
        command: "requestFileSuggestions",
        filterText: "hello",
        dir: "other",
        requestId: "req-q",
      },
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "fileSuggestionsResponse",
        requestId: "req-q",
        suggestions: expect.arrayContaining([
          expect.objectContaining({
            name: "hello.ts",
            relativePath: "src/hello.ts",
          }),
        ]),
      }),
    );

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/workdirHost.test.ts`

Expected: FAIL — 空 filter 仍走全库搜索，`src` 列表里会出现多余项或缺少「只含 hello.ts」的约束

- [ ] **Step 3: 改 host 分支**

`packages/desktop/src/main/workdirHost.ts` 顶部 import 改为：

```ts
import { listWorkspaceDir, searchWorkspaceFiles } from "./fileSearch.js";
```

`requestFileSuggestions` 处理改为：

```ts
    if (command === "requestFileSuggestions") {
      const requestId =
        typeof msg.requestId === "string" ? msg.requestId : undefined;
      const filterText =
        typeof msg.filterText === "string" ? msg.filterText : "";
      const dir = typeof msg.dir === "string" ? msg.dir : "";
      const cwd = state.workdir;
      try {
        const query = filterText.trim();
        const suggestions = cwd
          ? query
            ? searchWorkspaceFiles(cwd, { query, maxResults: 20 })
            : listWorkspaceDir(cwd, dir)
          : [];
        pushToWebview(win, {
          command: "fileSuggestionsResponse",
          suggestions,
          filterText,
          requestId,
        });
      } catch (err) {
        pushToWebview(win, {
          command: "fileSuggestionsError",
          error: err instanceof Error ? err.message : String(err),
          requestId,
        });
      }
      return;
    }
```

无 workdir 时仍返回 `[]`，不抛错。

- [ ] **Step 4: 再跑测试确认通过**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/workdirHost.test.ts tests/fileSearch.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/workdirHost.ts packages/desktop/tests/workdirHost.test.ts
git commit -m "$(cat <<'EOF'
feat: browse dir children on empty @ file suggestions

EOF
)"
```

---

### Task 3: 浏览路径 / 请求 payload / 键盘纯函数

**Files:**
- Create: `packages/webview/src/utils/fileMentionBrowse.ts`
- Create: `packages/webview/tests/muse/fileMentionBrowse.test.ts`

**Interfaces:**
- Consumes: none（webview 侧，不依赖 desktop）
- Produces: 下列导出，Task 4 / Task 5 必须用这些名字：

```ts
export function parentBrowsePath(browsePath: string): string;
export function dirFromRelativePath(relativePath: string): string;
export function breadcrumbCrumbs(
  browsePath: string,
): Array<{ label: string; path: string }>;
export function fileSuggestionsRequestPayload(
  filterText: string,
  browsePath: string,
  requestId: string,
): {
  command: "requestFileSuggestions";
  filterText: string;
  requestId: string;
  dir?: string;
};

export type FileMentionKeyAction =
  | { type: "move"; delta: number }
  | { type: "select"; index: number }
  | { type: "enterDir"; index: number }
  | { type: "goUp" }
  | { type: "close" };

export function resolveFileMentionKey(opts: {
  key: string;
  filterText: string;
  browsePath: string;
  suggestions: Array<{ isDirectory: boolean }>;
  selectedIndex: number;
}): FileMentionKeyAction | null;
```

- [ ] **Step 1: 写失败测试**

`packages/webview/tests/muse/fileMentionBrowse.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  breadcrumbCrumbs,
  dirFromRelativePath,
  fileSuggestionsRequestPayload,
  parentBrowsePath,
  resolveFileMentionKey,
} from "../../src/utils/fileMentionBrowse";

describe("parentBrowsePath / dirFromRelativePath", () => {
  it("strips trailing slash and walks up", () => {
    expect(dirFromRelativePath("src/components/")).toBe("src/components");
    expect(parentBrowsePath("src/components")).toBe("src");
    expect(parentBrowsePath("src")).toBe("");
    expect(parentBrowsePath("")).toBe("");
  });
});

describe("breadcrumbCrumbs", () => {
  it("starts at 工作区 and accumulates paths", () => {
    expect(breadcrumbCrumbs("")).toEqual([{ label: "工作区", path: "" }]);
    expect(breadcrumbCrumbs("src/components")).toEqual([
      { label: "工作区", path: "" },
      { label: "src", path: "src" },
      { label: "components", path: "src/components" },
    ]);
  });
});

describe("fileSuggestionsRequestPayload", () => {
  it("sends dir only when filter is empty", () => {
    expect(fileSuggestionsRequestPayload("", "src", "1")).toEqual({
      command: "requestFileSuggestions",
      filterText: "",
      requestId: "1",
      dir: "src",
    });
    expect(fileSuggestionsRequestPayload("hello", "src", "2")).toEqual({
      command: "requestFileSuggestions",
      filterText: "hello",
      requestId: "2",
    });
  });
});

describe("resolveFileMentionKey", () => {
  const dir = { isDirectory: true };
  const file = { isDirectory: false };

  it("Enter selects, ArrowRight enters a directory, ArrowLeft/Backspace go up", () => {
    expect(
      resolveFileMentionKey({
        key: "Enter",
        filterText: "",
        browsePath: "",
        suggestions: [dir],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "select", index: 0 });

    expect(
      resolveFileMentionKey({
        key: "ArrowRight",
        filterText: "",
        browsePath: "",
        suggestions: [dir],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "enterDir", index: 0 });

    expect(
      resolveFileMentionKey({
        key: "ArrowRight",
        filterText: "",
        browsePath: "",
        suggestions: [file],
        selectedIndex: 0,
      }),
    ).toBeNull();

    expect(
      resolveFileMentionKey({
        key: "ArrowLeft",
        filterText: "",
        browsePath: "src",
        suggestions: [dir],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "goUp" });

    expect(
      resolveFileMentionKey({
        key: "Backspace",
        filterText: "",
        browsePath: "src",
        suggestions: [],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "goUp" });

    expect(
      resolveFileMentionKey({
        key: "Backspace",
        filterText: "",
        browsePath: "",
        suggestions: [],
        selectedIndex: 0,
      }),
    ).toBeNull();

    expect(
      resolveFileMentionKey({
        key: "Backspace",
        filterText: "s",
        browsePath: "",
        suggestions: [file],
        selectedIndex: 0,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @muse-work/webview exec vitest run tests/muse/fileMentionBrowse.test.ts`

Expected: FAIL，无法解析 `fileMentionBrowse` 模块

- [ ] **Step 3: 实现工具函数**

`packages/webview/src/utils/fileMentionBrowse.ts` 全文：

```ts
export function dirFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\/+$/, "");
}

export function parentBrowsePath(browsePath: string): string {
  const parts = dirFromRelativePath(browsePath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function breadcrumbCrumbs(
  browsePath: string,
): Array<{ label: string; path: string }> {
  const crumbs = [{ label: "工作区", path: "" }];
  const parts = dirFromRelativePath(browsePath).split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

export function fileSuggestionsRequestPayload(
  filterText: string,
  browsePath: string,
  requestId: string,
): {
  command: "requestFileSuggestions";
  filterText: string;
  requestId: string;
  dir?: string;
} {
  const payload = {
    command: "requestFileSuggestions" as const,
    filterText,
    requestId,
  };
  if (filterText.trim() === "") {
    return { ...payload, dir: browsePath };
  }
  return payload;
}

export type FileMentionKeyAction =
  | { type: "move"; delta: number }
  | { type: "select"; index: number }
  | { type: "enterDir"; index: number }
  | { type: "goUp" }
  | { type: "close" };

export function resolveFileMentionKey(opts: {
  key: string;
  filterText: string;
  browsePath: string;
  suggestions: Array<{ isDirectory: boolean }>;
  selectedIndex: number;
}): FileMentionKeyAction | null {
  const { key, filterText, browsePath, suggestions, selectedIndex } = opts;

  switch (key) {
    case "ArrowUp":
      return suggestions.length > 0 ? { type: "move", delta: -1 } : null;
    case "ArrowDown":
      return suggestions.length > 0 ? { type: "move", delta: 1 } : null;
    case "Enter":
      return { type: "select", index: selectedIndex };
    case "ArrowRight":
      return suggestions[selectedIndex]?.isDirectory
        ? { type: "enterDir", index: selectedIndex }
        : null;
    case "ArrowLeft":
      return browsePath ? { type: "goUp" } : null;
    case "Backspace":
      return !filterText && browsePath ? { type: "goUp" } : null;
    case "Escape":
      return { type: "close" };
    default:
      return null;
  }
}
```

- [ ] **Step 4: 再跑测试确认通过**

Run: `pnpm -F @muse-work/webview exec vitest run tests/muse/fileMentionBrowse.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/utils/fileMentionBrowse.ts packages/webview/tests/muse/fileMentionBrowse.test.ts
git commit -m "$(cat <<'EOF'
feat: add @ mention browse path helpers

EOF
)"
```

---

### Task 4: Dropdown 浏览头 + 搜索单行排版

**Files:**
- Modify: `packages/webview/src/types/index.ts`（`FileSuggestionDropdownProps`）
- Modify: `packages/webview/src/components/FileSuggestionDropdown.tsx`
- Modify: `packages/webview/src/styles/FileSuggestionDropdown.css`
- Create: `packages/webview/tests/components/fileSuggestionDropdown.test.tsx`

**Interfaces:**
- Consumes: `breadcrumbCrumbs` from `../utils/fileMentionBrowse`；现有 `FileItem`
- Produces: `FileSuggestionDropdownProps` 增加：

```ts
  browsePath?: string;
  onEnterDirectory?: (file: FileItem) => void;
  onBrowseTo?: (path: string) => void;
```

行为：
- `filterText === ""`：顶栏面包屑；行 = 图标 + 名称；目录行尾 `codicon-chevron-right`；空列表文案「此目录为空」
- `filterText` 非空：无面包屑、无箭头；行 = 图标 + 名称 + 右侧灰色 `relativePath`；空列表「未找到匹配的文件」
- 点名称 → `onSelect`；点箭头 → `onEnterDirectory`（`stopPropagation`）；点面包屑段 → `onBrowseTo(path)`
- 滚动高亮用 `.suggestion-item:not(.suggestion-empty)`，不要用 `dropdownRef.children[selectedIndex]`（前面会多出面包屑节点）

- [ ] **Step 1: 扩展 props 类型**

把 `packages/webview/src/types/index.ts` 里的 `FileSuggestionDropdownProps` 换成：

```ts
export interface FileSuggestionDropdownProps {
  suggestions: FileItem[];
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (file: FileItem) => void;
  onClose: () => void;
  position: { top: number; left: number };
  filterText: string;
  isLoading?: boolean;
  browsePath?: string;
  onEnterDirectory?: (file: FileItem) => void;
  onBrowseTo?: (path: string) => void;
}
```

- [ ] **Step 2: 写失败的组件测试**

`packages/webview/tests/components/fileSuggestionDropdown.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileSuggestionDropdown } from "../../src/components/FileSuggestionDropdown";
import type { FileItem } from "../../src/types";

const srcDir: FileItem = {
  path: "/ws/src",
  relativePath: "src/",
  name: "src",
  extension: "",
  icon: "codicon-folder",
  isDirectory: true,
};

const hello: FileItem = {
  path: "/ws/src/hello.ts",
  relativePath: "src/hello.ts",
  name: "hello.ts",
  extension: "ts",
  icon: "codicon-file",
  isDirectory: false,
};

const position = { top: 0, left: 0 };

describe("FileSuggestionDropdown", () => {
  it("browse mode shows breadcrumb and enter chevron; click chevron does not select", () => {
    const onSelect = vi.fn();
    const onEnterDirectory = vi.fn();
    const onBrowseTo = vi.fn();

    render(
      <FileSuggestionDropdown
        suggestions={[srcDir]}
        isVisible
        selectedIndex={0}
        onSelect={onSelect}
        onClose={() => {}}
        position={position}
        filterText=""
        browsePath="lib"
        onEnterDirectory={onEnterDirectory}
        onBrowseTo={onBrowseTo}
      />,
    );

    expect(screen.getByTestId("suggestion-breadcrumb")).toHaveTextContent(
      "工作区",
    );
    expect(screen.getByTestId("suggestion-breadcrumb")).toHaveTextContent("lib");
    expect(screen.getByTestId("suggestion-enter-src")).toBeInTheDocument();
    expect(screen.queryByText("src/")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("suggestion-enter-src"));
    expect(onEnterDirectory).toHaveBeenCalledWith(srcDir);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "工作区" }));
    expect(onBrowseTo).toHaveBeenCalledWith("");
  });

  it("search mode shows name and path on one row without chevron", () => {
    render(
      <FileSuggestionDropdown
        suggestions={[hello]}
        isVisible
        selectedIndex={0}
        onSelect={() => {}}
        onClose={() => {}}
        position={position}
        filterText="hel"
        browsePath="lib"
      />,
    );

    expect(screen.queryByTestId("suggestion-breadcrumb")).not.toBeInTheDocument();
    expect(screen.getByText("hello.ts")).toBeInTheDocument();
    expect(screen.getByText("src/hello.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("suggestion-enter-hello.ts")).not.toBeInTheDocument();
  });

  it("shows empty-directory copy in browse mode", () => {
    render(
      <FileSuggestionDropdown
        suggestions={[]}
        isVisible
        selectedIndex={0}
        onSelect={() => {}}
        onClose={() => {}}
        position={position}
        filterText=""
        isLoading={false}
      />,
    );

    expect(screen.getByText("此目录为空")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/fileSuggestionDropdown.test.tsx`

Expected: FAIL（没有 `suggestion-breadcrumb` / 仍显示路径在名称下方 / 空态仍是「开始输入文件名」）

- [ ] **Step 4: 重写 dropdown 与 CSS**

`packages/webview/src/components/FileSuggestionDropdown.tsx` 全文：

```tsx
import React, { useEffect, useRef } from "react";
import { FileSuggestionDropdownProps, FileItem } from "../types";
import { breadcrumbCrumbs } from "../utils/fileMentionBrowse";
import "../styles/FileSuggestionDropdown.css";

export const FileSuggestionDropdown: React.FC<FileSuggestionDropdownProps> = ({
  suggestions,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
  position,
  filterText,
  isLoading = false,
  browsePath = "",
  onEnterDirectory,
  onBrowseTo,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isBrowse = filterText === "";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isVisible, onClose]);

  useEffect(() => {
    if (!dropdownRef.current || selectedIndex < 0) return;
    const items = dropdownRef.current.querySelectorAll(
      ".suggestion-item:not(.suggestion-empty)",
    );
    const selectedElement = items[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  if (!isVisible) {
    return null;
  }

  const highlightMatch = (text: string, filter: string): React.ReactNode => {
    if (!filter) return text;
    const lowerText = text.toLowerCase();
    const lowerFilter = filter.toLowerCase();
    const index = lowerText.indexOf(lowerFilter);
    if (index === -1) return text;
    return (
      <>
        {text.slice(0, index)}
        <span className="suggestion-highlight">
          {text.slice(index, index + filter.length)}
        </span>
        {text.slice(index + filter.length)}
      </>
    );
  };

  return (
    <div
      ref={dropdownRef}
      className={`file-suggestion-dropdown${isBrowse ? " is-browse" : " is-search"}`}
      style={{
        position: "absolute",
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {isBrowse && (
        <div className="suggestion-breadcrumb" data-testid="suggestion-breadcrumb">
          {breadcrumbCrumbs(browsePath).map((crumb, i) => (
            <span key={`${crumb.path}-${i}`} className="suggestion-crumb">
              {i > 0 && (
                <span className="suggestion-crumb-sep codicon codicon-chevron-right" />
              )}
              <button
                type="button"
                className="suggestion-crumb-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onBrowseTo?.(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {suggestions.map((file: FileItem, index: number) => (
        <div
          key={file.path}
          className={`suggestion-item${isBrowse ? "" : " search-row"}${
            index === selectedIndex ? " selected" : ""
          }`}
          onClick={() => onSelect(file)}
        >
          <span className={`suggestion-icon codicon ${file.icon}`}></span>
          <div className="suggestion-content">
            <div className="suggestion-name">
              {highlightMatch(file.name, filterText)}
            </div>
            {!isBrowse && (
              <div className="suggestion-path">{file.relativePath}</div>
            )}
          </div>
          {isBrowse && file.isDirectory && (
            <button
              type="button"
              className="suggestion-enter"
              data-testid={`suggestion-enter-${file.name}`}
              aria-label={`进入 ${file.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onEnterDirectory?.(file);
              }}
            >
              <span className="codicon codicon-chevron-right" />
            </button>
          )}
        </div>
      ))}

      {isLoading && suggestions.length === 0 && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-loading"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">正在搜索文件...</div>
          </div>
        </div>
      )}
      {!isLoading && suggestions.length === 0 && !isBrowse && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-search"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">未找到匹配的文件</div>
          </div>
        </div>
      )}
      {!isLoading && suggestions.length === 0 && isBrowse && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-folder"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">此目录为空</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileSuggestionDropdown;
```

CSS：保留 `.file-suggestion-dropdown` 外壳，把 `.suggestion-content` / `.suggestion-path` 改成搜索单行，并追加浏览样式。在 `packages/webview/src/styles/FileSuggestionDropdown.css` 里：

把 `.suggestion-content` 换成：

```css
.suggestion-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.suggestion-item.search-row .suggestion-content {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.suggestion-item.search-row .suggestion-path {
  margin-left: auto;
  text-align: right;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  opacity: 0.7;
}
```

文件末尾追加：

```css
.suggestion-breadcrumb {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-dropdown-border);
  background: var(--vscode-dropdown-background);
  font-size: 12px;
}

.suggestion-crumb {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.suggestion-crumb-sep {
  font-size: 10px;
  opacity: 0.5;
  margin: 0 2px;
}

.suggestion-crumb-btn {
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 0 2px;
  font: inherit;
}

.suggestion-crumb-btn:hover {
  color: var(--vscode-foreground);
  text-decoration: underline;
}

.suggestion-enter {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--vscode-descriptionForeground);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.suggestion-enter:hover {
  color: var(--vscode-foreground);
}
```

- [ ] **Step 5: 再跑测试确认通过**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/fileSuggestionDropdown.test.tsx tests/muse/fileMentionBrowse.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/webview/src/types/index.ts packages/webview/src/components/FileSuggestionDropdown.tsx packages/webview/src/styles/FileSuggestionDropdown.css packages/webview/tests/components/fileSuggestionDropdown.test.tsx
git commit -m "$(cat <<'EOF'
feat: restyle @ file dropdown for browse and search

EOF
)"
```

---

### Task 5: `MessageInput` 维护 `browsePath` 并接线键盘

**Files:**
- Modify: `packages/webview/src/components/MessageInput.tsx`
- Modify: `packages/webview/tests/components/messageInput.enter.test.tsx`（确认 Enter 发送用例仍过；本任务不靠 contenteditable 测 @，键盘逻辑已在 Task 3）

**Interfaces:**
- Consumes:
  - `fileSuggestionsRequestPayload(filterText, browsePath, requestId)`
  - `dirFromRelativePath` / `parentBrowsePath`
  - `resolveFileMentionKey`
- Produces: 空 `@` 的 `postMessage` 带 `dir`；有 filter 不带 `dir`；Enter 仍走现有 `handleFileSelect`（插入格式不变）

**规则（必须按这个接）：**
- `browsePath` state + `browsePathRef`（键盘 / 请求都读 ref，避免闭包过期）
- 有 `filterText` 时立刻把 `browsePath` / ref 置 `""`
- 进入目录、点面包屑、返回上一层：只改 `browsePath` 并 `requestFileSuggestions`，**不**改输入框
- `closeDropdown` 同时清空 `browsePath`
- 弹层可见：`atMention.isActive && (suggestions.length > 0 || isLoadingSuggestions || !atMention.filterText)`（空目录也要显示）
- `atMention.isActive` 时就走 `resolveFileMentionKey`（不要再要求 `suggestions.length > 0`，否则空目录无法 ← / Backspace）
- 提及激活时 Enter 一律 `preventDefault`，有高亮项才 `handleFileSelect`

- [ ] **Step 1: 先跑现有 Enter 测试（基线）**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/messageInput.enter.test.tsx`

Expected: PASS（尚未改 MessageInput）

- [ ] **Step 2: 改 MessageInput**

文件顶部 import 增加：

```ts
import {
  dirFromRelativePath,
  fileSuggestionsRequestPayload,
  parentBrowsePath,
  resolveFileMentionKey,
} from "../utils/fileMentionBrowse";
```

在 `isLoadingSuggestions` state 旁增加：

```ts
    const [browsePath, setBrowsePath] = useState("");
    const browsePathRef = useRef("");
```

加两个小函数（放在 `requestFileSuggestions` 附近）：

```ts
    const setBrowsePathBoth = useCallback((next: string) => {
      browsePathRef.current = next;
      setBrowsePath(next);
    }, []);
```

`closeDropdown` 改为：

```ts
    const closeDropdown = useCallback(() => {
      setAtMention({ isActive: false, filterText: "", startPos: 0, endPos: 0 });
      setSuggestions([]);
      setSelectedIndex(0);
      setIsLoadingSuggestions(false);
      browsePathRef.current = "";
      setBrowsePath("");
    }, []);
```

`requestFileSuggestions` 换成：

```ts
    const requestFileSuggestions = useCallback(
      (filterText: string, dir?: string) => {
        const requestId = Date.now().toString();
        requestIdRef.current = requestId;
        setIsLoadingSuggestions(true);
        vscode.postMessage(
          fileSuggestionsRequestPayload(
            filterText,
            dir ?? browsePathRef.current,
            requestId,
          ),
        );
      },
      [vscode],
    );
```

进入 / 返回（放在 `handleFileSelect` 之前）：

```ts
    const enterDirectory = useCallback(
      (file: FileItem) => {
        if (!file.isDirectory) return;
        const next = dirFromRelativePath(file.relativePath);
        setBrowsePathBoth(next);
        setSelectedIndex(0);
        requestFileSuggestions("", next);
      },
      [requestFileSuggestions, setBrowsePathBoth],
    );

    const goUpDirectory = useCallback(() => {
      const next = parentBrowsePath(browsePathRef.current);
      setBrowsePathBoth(next);
      setSelectedIndex(0);
      requestFileSuggestions("", next);
    }, [requestFileSuggestions, setBrowsePathBoth]);
```

`handleSelectionChange` 里 `else` 分支（`mentionState.isActive`）改成：

```ts
          setAtMention(mentionState);
          setDropdownPosition(calculateDropdownPosition());
          if (mentionState.filterText) {
            setBrowsePathBoth("");
            requestFileSuggestions(mentionState.filterText);
          } else {
            requestFileSuggestions("", browsePathRef.current);
          }
```

依赖数组加上 `setBrowsePathBoth`。

`handleKeyDown` 里「Handle dropdown navigation」整段换成（保留前面的 Ctrl+B）：

```ts
        if (atMention.isActive) {
          const action = resolveFileMentionKey({
            key: event.key,
            filterText: atMention.filterText,
            browsePath: browsePathRef.current,
            suggestions,
            selectedIndex,
          });

          if (action) {
            event.preventDefault();
            switch (action.type) {
              case "move": {
                const maxIndex = suggestions.length - 1;
                setSelectedIndex((prev: number) =>
                  Math.max(0, Math.min(maxIndex, prev + action.delta)),
                );
                break;
              }
              case "select":
                if (suggestions[action.index]) {
                  handleFileSelect(suggestions[action.index]);
                }
                break;
              case "enterDir":
                if (suggestions[action.index]) {
                  enterDirectory(suggestions[action.index]);
                }
                break;
              case "goUp":
                goUpDirectory();
                break;
              case "close":
                if (isStreaming) {
                  onAbortMessage();
                }
                closeDropdown();
                break;
            }
            return;
          }
        }
```

`handleKeyDown` 依赖数组加上 `enterDirectory`、`goUpDirectory`、`browsePath` 不必加（用 ref）。

`<FileSuggestionDropdown>` 改为：

```tsx
          <FileSuggestionDropdown
            suggestions={suggestions}
            isVisible={
              !!(
                atMention.isActive &&
                (suggestions.length > 0 ||
                  isLoadingSuggestions ||
                  !atMention.filterText)
              )
            }
            selectedIndex={selectedIndex}
            onSelect={handleFileSelect}
            onClose={closeDropdown}
            position={dropdownPosition}
            filterText={atMention.filterText}
            isLoading={isLoadingSuggestions}
            browsePath={browsePath}
            onEnterDirectory={enterDirectory}
            onBrowseTo={(path) => {
              setBrowsePathBoth(path);
              setSelectedIndex(0);
              requestFileSuggestions("", path);
            }}
          />
```

**不要**改 `handleFileSelect` 的插入逻辑。

- [ ] **Step 3: 跑 webview 相关测试**

Run: `pnpm -F @muse-work/webview exec vitest run tests/components/messageInput.enter.test.tsx tests/components/fileSuggestionDropdown.test.tsx tests/muse/fileMentionBrowse.test.ts`

Expected: PASS

- [ ] **Step 4: 跑 desktop + webview 回归**

Run:

```bash
pnpm -F @muse-work/desktop exec vitest run tests/fileSearch.test.ts tests/workdirHost.test.ts
pnpm -F @muse-work/webview test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/MessageInput.tsx
git commit -m "$(cat <<'EOF'
feat: wire @ mention browse path and keyboard navigation

EOF
)"
```

---

## 手动验收（桌面）

实现完成后用 `env -u ELECTRON_RUN_AS_NODE pnpm dev:desktop`：

1. 输入单独 `@`：根目录一层，目录在前，有面包屑「工作区」，目录行有 →
2. 点箭头或按 →：进入子目录，输入框仍是 `@`，不是 `@src/`
3. Enter 或点名称：插入 `[@file:…]`；目录带尾 `/`
4. ← 或（仍为单独 `@` 时）Backspace：回到上一层；根目录 Backspace 删除 `@`
5. 输入 `@hello`：无面包屑、无箭头；名称在左、灰色路径在右
6. 删回单独 `@`：回到工作区根浏览，而不是停留在刚才钻入的目录
7. 空目录显示「此目录为空」；无搜索命中显示「未找到匹配的文件」
8. `node_modules` / `.git` 不出现
