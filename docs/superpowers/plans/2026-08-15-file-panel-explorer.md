# File Panel Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 File 面板：右侧 workdir 虚拟文件树（图标 + 可拖拽宽度）、顶部路径栏图标、Shiki/Markdown/图片预览，以及对二进制与 >1MB 文件的 Finder reveal。

**Architecture:** 在现有 `FilePane` 内左预览 / 右树分栏。Host 扩展 `readLocalFileForPanel`（1MB + `unsupported`）、新增 `desktopListDir`（gitignore）与 `revealInFinder`。Webview 用 `@tanstack/react-virtual` 渲染树，`vscode-icons-js` 解析图标名，Shiki `github-light`/`github-dark` 高亮；树状态挂在 `panelGroupStore` 的 workdir group。

**Tech Stack:** pnpm monorepo、React 18、Zustand、`shiki`（`bundle/web` + JS regex engine）、`vscode-icons-js`、`@tanstack/react-virtual`、`ignore`（main）、Vitest + Testing Library、Electron `shell.showItemInFolder`

**Spec:** `docs/superpowers/specs/2026-08-15-file-panel-explorer-design.md`

## Global Constraints

- 布局：左预览 + 右文件树；顶栏跨全宽
- 树宽：可拖拽，`min = 180`，`max = 420`，默认 `240`
- 过滤：尊重 `.gitignore`；始终跳过 `node_modules`、`.git`；解析失败回退硬编码 skip
- 路径栏：相对 workdir，否则绝对路径；中间省略 + 文件图标
- 不支持预览：`shell.showItemInFolder`（reveal，不是 `openPath`）
- 大小上限：**1MB**（文本与图片）
- 树状态：按 workdir 内存缓存（展开 / 选中 / 宽度）；打开文件 ensure-expand
- Markdown：默认 Preview；可切 Source（Shiki）
- Desktop local only；不做远程树 / 文件监视 / 增删改
- 包管理器：pnpm；验证：`pnpm -F @muse-work/desktop test` + `pnpm -F @muse-work/webview test` + `type-check`

## File Structure

```text
packages/desktop/src/main/filePanel.ts              # 1MB + unsupported
packages/desktop/src/main/fileSearch.ts             # listDir + gitignore helper
packages/desktop/src/main/workdirHost.ts            # desktopListDir / revealInFinder
packages/desktop/tests/filePanel.test.ts
packages/desktop/tests/fileSearch.test.ts
packages/desktop/package.json                       # + ignore

packages/webview/package.json                       # + shiki, vscode-icons-js, @tanstack/react-virtual
packages/webview/esbuild.config.mjs                 # 如需为 shiki/wasm 或 svg 调整 loader（优先 JS engine，避免 wasm）
packages/webview/src/types/index.ts                 # FileViewState.unsupported；DirEntry；FileTreeState
packages/webview/src/stores/panelGroupStore.ts      # PanelGroupState.fileTree
packages/webview/src/components/panels/FileIcon.tsx
packages/webview/src/components/panels/FilePathBar.tsx
packages/webview/src/components/panels/FilePreview.tsx
packages/webview/src/components/panels/FileTree.tsx
packages/webview/src/components/panels/FilePane.tsx  # 组装
packages/webview/src/utils/shikiHighlighter.ts
packages/webview/src/utils/filePathDisplay.ts
packages/webview/src/styles/FilePane.css
packages/webview/src/components/ChatApp.tsx         # listDir / reveal / fileTree props
packages/webview/tests/webview/filePane.test.tsx
packages/webview/tests/components/fileTree.test.tsx
packages/webview/tests/muse/filePathDisplay.test.ts
```

---

### Task 1: Host — `readLocalFileForPanel` 1MB + `unsupported`

**Files:**
- Modify: `packages/desktop/src/main/filePanel.ts`
- Modify: `packages/desktop/tests/filePanel.test.ts`
- Modify: `packages/webview/src/types/index.ts`（同步 `FileViewState` 字段，供后续 UI）

**Interfaces — Produces:**
- `FilePanelView.unsupported?: "binary" | "too-large"`
- `FilePanelView.sizeBytes?: number`
- `MAX_BYTES = 1 * 1024 * 1024`
- 图片与文本均受 1MB 限制；超限 / 二进制不返回 `content` / `imageBase64`

- [ ] **Step 1: Write failing tests**

在 `packages/desktop/tests/filePanel.test.ts` 追加：

```ts
it("marks files larger than 1MB as too-large", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
  const file = path.join(dir, "big.txt");
  fs.writeFileSync(file, Buffer.alloc(1 * 1024 * 1024 + 1, 0x61));
  const view = await readLocalFileForPanel(file);
  expect(view.unsupported).toBe("too-large");
  expect(view.content).toBeUndefined();
  expect(view.sizeBytes).toBe(1 * 1024 * 1024 + 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

it("marks binary files as binary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
  const file = path.join(dir, "blob.bin");
  fs.writeFileSync(file, Buffer.from([0, 1, 2, 3, 0, 4]));
  const view = await readLocalFileForPanel(file);
  expect(view.unsupported).toBe("binary");
  expect(view.content).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("rejects oversized images", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-file-"));
  const file = path.join(dir, "big.png");
  // Minimal PNG header bytes + pad past 1MB
  const buf = Buffer.alloc(1 * 1024 * 1024 + 10, 0);
  buf.write("\x89PNG\r\n\x1a\n", 0);
  fs.writeFileSync(file, buf);
  const view = await readLocalFileForPanel(file);
  expect(view.unsupported).toBe("too-large");
  expect(view.imageBase64).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm -F @muse-work/desktop test -- tests/filePanel.test.ts
```

- [ ] **Step 3: Implement**

更新 `filePanel.ts`：

```ts
const MAX_BYTES = 1 * 1024 * 1024;

export type FilePanelView = {
  path: string;
  host: string;
  content?: string;
  imageBase64?: string;
  error?: string;
  unsupported?: "binary" | "too-large";
  sizeBytes?: number;
  truncated?: boolean;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
};
```

在 `stat` 成功后：

```ts
if (stat.size > MAX_BYTES) {
  return {
    path: filePath,
    host,
    unsupported: "too-large",
    sizeBytes: stat.size,
    startLine: opts?.startLine,
    endLine: opts?.endLine,
  };
}
```

图片分支仅在 `stat.size <= MAX_BYTES` 时读入。二进制检测改为返回 `unsupported: "binary"`（不再用 `error` 文案）。真正的 IO / 不存在仍用 `error`。

同步 `packages/webview/src/types/index.ts` 的 `FileViewState` 增加相同可选字段。

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm -F @muse-work/desktop test -- tests/filePanel.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/filePanel.ts packages/desktop/tests/filePanel.test.ts packages/webview/src/types/index.ts
git commit -m "$(cat <<'EOF'
feat(desktop): mark oversized and binary files unsupported in file panel

EOF
)"
```

---

### Task 2: Host — `revealInFinder`

**Files:**
- Modify: `packages/desktop/src/main/workdirHost.ts`
- Modify: `packages/desktop/tests/workdirHost.test.ts`

**Interfaces — Produces:**
- Webview → host: `{ command: "revealInFinder", path: string }`
- Host 调用 `shell.showItemInFolder(path)`（可注入以便测试）
- 无回包（fire-and-forget）；路径非法则 no-op

- [ ] **Step 1: Write failing test**

在 `workdirHost.test.ts` 增加可注入 `showItemInFolder`（若构造函数/options 尚无该字段则扩展 `WorkdirHostOptions`）：

```ts
it("revealInFinder calls showItemInFolder", async () => {
  const showItemInFolder = vi.fn();
  const { handle, win } = createHost({ showItemInFolder });
  await handle({ command: "revealInFinder", path: "/tmp/a.ts" });
  expect(showItemInFolder).toHaveBeenCalledWith("/tmp/a.ts");
});
```

按现有 `createHost` / `workdirHost` 测试风格对齐命名。

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm -F @muse-work/desktop test -- tests/workdirHost.test.ts
```

- [ ] **Step 3: Implement**

在 `createWorkdirHost` options 增加：

```ts
showItemInFolder?: (filePath: string) => void;
```

默认：`shell.showItemInFolder.bind(shell)`（Electron）。在 message switch 中：

```ts
if (command === "revealInFinder" && typeof msg.path === "string" && msg.path) {
  showItemInFolder(msg.path);
  return;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm -F @muse-work/desktop test -- tests/workdirHost.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/workdirHost.ts packages/desktop/tests/workdirHost.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): reveal files in Finder from file panel

EOF
)"
```

---

### Task 3: Host — `desktopListDir` + gitignore

**Files:**
- Modify: `packages/desktop/package.json`（dependency `ignore`）
- Modify: `packages/desktop/src/main/fileSearch.ts`
- Modify: `packages/desktop/src/main/workdirHost.ts`
- Modify: `packages/desktop/tests/fileSearch.test.ts`
- Modify: `packages/desktop/tests/workdirHost.test.ts`

**Interfaces — Produces:**
- `listWorkspaceDir(workdir, dir, opts?: { respectGitignore?: boolean })` — 默认对面板 list 启用 gitignore
- Webview: `{ command: "desktopListDir", requestId, dir }`
- Host reply: `{ command: "desktopListDirResult", requestId, entries }`  
  其中 `entries: { name, path, relativePath, isDirectory }[]`
- 始终跳过 `node_modules`、`.git`；合并 workdir 向上找到的 `.gitignore`；失败则仅硬编码 skip

- [ ] **Step 1: Install + failing tests**

```bash
pnpm -F @muse-work/desktop add ignore
```

`fileSearch.test.ts` 追加：

```ts
it("hides gitignored files when respectGitignore is true", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-ls-"));
  fs.writeFileSync(path.join(root, ".gitignore"), "secret.txt\n");
  fs.writeFileSync(path.join(root, "secret.txt"), "x");
  fs.writeFileSync(path.join(root, "ok.ts"), "x");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "x"), "x");
  const hits = listWorkspaceDir(root, "", { respectGitignore: true });
  const names = hits.map((h) => h.name);
  expect(names).toContain("ok.ts");
  expect(names).not.toContain("secret.txt");
  expect(names).not.toContain("node_modules");
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm -F @muse-work/desktop test -- tests/fileSearch.test.ts
```

- [ ] **Step 3: Implement gitignore + list API**

在 `fileSearch.ts`：

```ts
import ignore from "ignore";

export type ListWorkspaceDirOptions = {
  respectGitignore?: boolean;
};

function loadIgnoreFilter(workdirAbs: string) {
  const ig = ignore();
  ig.add(["node_modules/", ".git/"]);
  // Walk workdir → parents until filesystem root; merge each .gitignore
  let dir = workdirAbs;
  for (;;) {
    const gi = path.join(dir, ".gitignore");
    try {
      ig.add(fs.readFileSync(gi, "utf8"));
    } catch {
      /* missing is fine */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ig;
}
```

在 `listWorkspaceDir` 中，当 `respectGitignore` 时用 `ig.ignores(rel)` / `ig.ignores(rel + "/")` 过滤；目录仍用硬编码 `isSkippedDir` 作为额外兜底（至少 `.git` / `node_modules`）。`@` 提及路径可保持默认 `respectGitignore: false`（或 true——若改变 @ 行为需在测试中明示；**推荐面板 list 传 true，@ 提及保持现状 false**）。

`workdirHost`：

```ts
if (command === "desktopListDir") {
  const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
  const dir = typeof msg.dir === "string" ? msg.dir : "";
  const cwd = state.workdir;
  const entries = cwd
    ? listWorkspaceDir(cwd, dir, { respectGitignore: true }).map((e) => ({
        name: e.name,
        path: e.path,
        relativePath: e.relativePath.replace(/\/$/, ""),
        isDirectory: e.isDirectory,
      }))
    : [];
  pushToWebview(win, { command: "desktopListDirResult", requestId, entries });
  return;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm -F @muse-work/desktop test -- tests/fileSearch.test.ts tests/workdirHost.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/main/fileSearch.ts packages/desktop/src/main/workdirHost.ts packages/desktop/tests/fileSearch.test.ts packages/desktop/tests/workdirHost.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(desktop): list workdir entries with gitignore for file tree

EOF
)"
```

---

### Task 4: Webview store — `fileTree` 状态

**Files:**
- Modify: `packages/webview/src/types/index.ts`
- Modify: `packages/webview/src/stores/panelGroupStore.ts`
- Create: `packages/webview/tests/stores/fileTreeState.test.ts`

**Interfaces — Produces:**

```ts
export type FileTreeDirEntry = {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
};

export type FileTreeState = {
  expanded: string[]; // relative dirs, "" = root loaded
  selected?: string;  // absolute path
  width: number;
  childrenCache: Record<string, FileTreeDirEntry[]>;
};

export const FILE_TREE_WIDTH_MIN = 180;
export const FILE_TREE_WIDTH_MAX = 420;
export const FILE_TREE_WIDTH_DEFAULT = 240;

export function emptyFileTreeState(): FileTreeState;
export function clampFileTreeWidth(width: number): number;
export function ensureExpandedForFile(
  tree: FileTreeState,
  workdir: string,
  fileAbsPath: string,
): FileTreeState;
```

`PanelGroupState.fileTree: FileTreeState`；`emptyPanelGroup()` 初始化 `fileTree: emptyFileTreeState()`。

- [ ] **Step 1: Failing tests**

```ts
/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  clampFileTreeWidth,
  ensureExpandedForFile,
  emptyFileTreeState,
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX,
} from "../../src/stores/panelGroupStore";

describe("clampFileTreeWidth", () => {
  it("clamps to min/max", () => {
    expect(clampFileTreeWidth(100)).toBe(FILE_TREE_WIDTH_MIN);
    expect(clampFileTreeWidth(999)).toBe(FILE_TREE_WIDTH_MAX);
    expect(clampFileTreeWidth(240)).toBe(240);
  });
});

describe("ensureExpandedForFile", () => {
  it("expands ancestor dirs under workdir", () => {
    const next = ensureExpandedForFile(
      emptyFileTreeState(),
      "/work/proj",
      "/work/proj/src/a/b.ts",
    );
    expect(next.expanded).toEqual(expect.arrayContaining(["src", "src/a"]));
    expect(next.selected).toBe("/work/proj/src/a/b.ts");
  });

  it("no-ops expand when file is outside workdir", () => {
    const base = emptyFileTreeState();
    const next = ensureExpandedForFile(base, "/work/proj", "/other/x.ts");
    expect(next.expanded).toEqual(base.expanded);
    expect(next.selected).toBe("/other/x.ts");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm -F @muse-work/webview test -- tests/stores/fileTreeState.test.ts
```

- [ ] **Step 3: Implement helpers + store field**

在 `panelGroupStore.ts` 实现上述函数；`expanded` 用去重 merge（保留用户已展开项）。路径分隔统一 `/`（macOS/linux；Windows 若出现 `\` 先 replace）。

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm -F @muse-work/webview test -- tests/stores/fileTreeState.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/types/index.ts packages/webview/src/stores/panelGroupStore.ts packages/webview/tests/stores/fileTreeState.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add fileTree state to panel groups

EOF
)"
```

---

### Task 5: `FileIcon` + 路径展示工具

**Files:**
- Create: `packages/webview/src/components/panels/FileIcon.tsx`
- Create: `packages/webview/src/utils/filePathDisplay.ts`
- Create: `packages/webview/tests/muse/filePathDisplay.test.ts`
- Modify: `packages/webview/package.json`（`vscode-icons-js`）

**Interfaces — Produces:**
- `displayFilePath(absPath, workdir?: string): string` — workdir 前缀则相对，否则绝对
- `middleEllipsis(text, max = 48): string`（可从 FilePane 抽出）
- `FileIcon({ name, isDirectory?, isOpen? })` — `getIconForFile` / `getIconForFolder` / `getIconForOpenFolder`；`<img>` src 用 jsDelivr：  
  `https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@12.12.0/icons/${svg}`  
  `onError` 回退到 `<i className="codicon codicon-file|folder" />`

- [ ] **Step 1: Install + failing path tests**

```bash
pnpm -F @muse-work/webview add vscode-icons-js
```

```ts
import { displayFilePath, middleEllipsis } from "../../src/utils/filePathDisplay";

it("uses relative path under workdir", () => {
  expect(displayFilePath("/a/b/c.ts", "/a/b")).toBe("c.ts");
  expect(displayFilePath("/a/b/src/x.ts", "/a/b")).toBe("src/x.ts");
});

it("uses absolute when outside workdir", () => {
  expect(displayFilePath("/other/x.ts", "/a/b")).toBe("/other/x.ts");
});
```

- [ ] **Step 2–4: Implement utils + FileIcon，跑通测试**

```tsx
import {
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from "vscode-icons-js";

const ICON_CDN =
  "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@12.12.0/icons";

export function FileIcon(props: {
  name: string;
  isDirectory?: boolean;
  isOpen?: boolean;
  className?: string;
}) {
  const svg = props.isDirectory
    ? props.isOpen
      ? getIconForOpenFolder(props.name)
      : getIconForFolder(props.name)
    : getIconForFile(props.name);
  const [failed, setFailed] = React.useState(false);
  if (failed || !svg) {
    return (
      <i
        className={`codicon ${props.isDirectory ? "codicon-folder" : "codicon-file"} ${props.className ?? ""}`}
      />
    );
  }
  return (
    <img
      className={props.className ?? "file-icon"}
      src={`${ICON_CDN}/${svg}`}
      alt=""
      width={16}
      height={16}
      onError={() => setFailed(true)}
    />
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/package.json pnpm-lock.yaml packages/webview/src/components/panels/FileIcon.tsx packages/webview/src/utils/filePathDisplay.ts packages/webview/tests/muse/filePathDisplay.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add FileIcon and path display helpers

EOF
)"
```

---

### Task 6: `FileTree`（虚拟列表 + 宽度拖拽 + listDir）

**Files:**
- Create: `packages/webview/src/components/panels/FileTree.tsx`
- Create: `packages/webview/tests/components/fileTree.test.tsx`
- Modify: `packages/webview/package.json`（`@tanstack/react-virtual`）
- Modify: `packages/webview/src/styles/FilePane.css`

**Interfaces — Consumes:**
- `desktopListDir` / `desktopListDirResult`
- `FileTreeState` + `clampFileTreeWidth` / `ensureExpandedForFile`
- `FileIcon`

**Produces:**
- `FileTree` props：

```ts
export type FileTreeProps = {
  workdir: string | undefined;
  vscode: { postMessage: (msg: unknown) => void };
  tree: FileTreeState;
  onTreeChange: (next: FileTreeState) => void;
  onOpenFile: (absPath: string) => void;
};
```

行为：
- 有 workdir 时加载 `dir=""`；展开目录再请求并写入 `childrenCache`
- 扁平化 `expanded` 可见行 → `@tanstack/react-virtual`
- 点击文件 → `onOpenFile`；点击目录 → toggle expanded
- 左侧竖向 drag-handle 调 `tree.width`（钳 min/max）
- `requestId` 用递增计数，忽略过期响应

- [ ] **Step 1: Install + failing component test**

```bash
pnpm -F @muse-work/webview add @tanstack/react-virtual
```

测试：mock `postMessage`，模拟 `desktopListDirResult`，断言渲染文件名、点击调用 `onOpenFile`。用 `vscode` 事件总线：组件需能接收结果——通过 props `entries` **或** 在测试里直接 `window`/`vscode` mock 回调。

推荐接线：`FileTree` 自己 `postMessage`；父组件在 `ChatApp` 的 message handler 里把 `desktopListDirResult` 转成自定义事件 / 或把 result 写入 store cache。

**选定：** `ChatApp` 收到 `desktopListDirResult` 时 `patchGroup` 合并 `fileTree.childrenCache[dir]`；`FileTree` 只读 cache，缺省时 post `desktopListDir`。

- [ ] **Step 2–4: 实现 FileTree + CSS（树列、drag handle、行高 22px）并让测试通过**

扁平化伪代码：

```ts
function flatten(
  cache: Record<string, FileTreeDirEntry[]>,
  expanded: Set<string>,
  dir = "",
  depth = 0,
): Array<FileTreeDirEntry & { depth: number }> {
  const entries = cache[dir] ?? [];
  const out: Array<FileTreeDirEntry & { depth: number }> = [];
  for (const e of entries) {
    out.push({ ...e, depth });
    if (e.isDirectory && expanded.has(e.relativePath)) {
      out.push(...flatten(cache, expanded, e.relativePath, depth + 1));
    }
  }
  return out;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/package.json pnpm-lock.yaml packages/webview/src/components/panels/FileTree.tsx packages/webview/tests/components/fileTree.test.tsx packages/webview/src/styles/FilePane.css
git commit -m "$(cat <<'EOF'
feat(webview): add virtual workdir file tree with resizable width

EOF
)"
```

---

### Task 7: Shiki highlighter + `FilePreview`

**Files:**
- Create: `packages/webview/src/utils/shikiHighlighter.ts`
- Create: `packages/webview/src/components/panels/FilePreview.tsx`
- Modify: `packages/webview/package.json`（`shiki`）
- Modify: `packages/webview/esbuild.config.mjs`（若构建失败再加 banner/`mainFields`；优先 JS engine）
- Modify: `packages/webview/tests/webview/filePane.test.tsx`（预览相关用例迁移/更新）

**Interfaces — Produces:**

```ts
// shikiHighlighter.ts
export function getShikiTheme(dark: boolean): "github-dark" | "github-light";
export function highlightCode(
  code: string,
  filePath: string,
  dark: boolean,
): Promise<string[]>; // per-line HTML fragments（span 平衡策略可复用或简化为按 \n split 后各自 highlight 不完美时用整块再 split）
```

使用：

```ts
import { createHighlighter } from "shiki/bundle/web";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const engine = createJavaScriptRegexEngine();
// singleton promise
```

语言：从扩展映射到 shiki lang id；未知 → `txt` / plaintext。

`FilePreview` props：

```ts
{
  fileView: FileViewState;
  workdir?: string;
  onRevealInFinder?: (path: string) => void;
}
```

分支：
- `unsupported` → 文案（二进制 / 文件过大）+ 按钮 `在 Finder 中显示`（仅 local + 有 callback）
- `imageBase64` → `<img>`
- markdown → 默认 Preview（现有 marked+DOMPurify，代码块可暂留 plain 或 shiki）；toolbar 切换由父级或本组件 state `mode: "preview" | "source"`，默认 `"preview"`
- 其他文本 → Shiki 行号视图；保留 `startLine`/`endLine` 高亮与滚动

主题：`useMuseTheme().effective` 或 `isDarkTheme()`。

- [ ] **Step 1: Install**

```bash
pnpm -F @muse-work/webview add shiki
```

写一个小单元测试 mock highlighter 较难；以组件测试为主：`unsupported` 渲染按钮并点击调用 `onRevealInFinder`；markdown 默认无 source 源码切换后出现。

- [ ] **Step 2–4: 实现并 `pnpm -F @muse-work/webview build` 确认 esbuild 通过；测试 PASS**

若 wasm 被拉入导致失败：强制只用 `createJavaScriptRegexEngine`，不要 import `shiki/wasm`。

- [ ] **Step 5: Commit**

```bash
git add packages/webview/package.json pnpm-lock.yaml packages/webview/src/utils/shikiHighlighter.ts packages/webview/src/components/panels/FilePreview.tsx packages/webview/esbuild.config.mjs packages/webview/tests/webview/filePane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): Shiki preview with markdown toggle and unsupported UI

EOF
)"
```

---

### Task 8: `FilePathBar` + `FilePane` 组装 + ChatApp 接线

**Files:**
- Create: `packages/webview/src/components/panels/FilePathBar.tsx`
- Modify: `packages/webview/src/components/panels/FilePane.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/src/styles/FilePane.css`
- Modify: `packages/webview/tests/webview/filePane.test.tsx`

**Interfaces — FilePane 新 props：**

```ts
{
  fileView: FileViewState | null;
  workdir?: string;
  vscode: { postMessage: (msg: unknown) => void };
  fileTree: FileTreeState;
  onFileTreeChange: (next: FileTreeState) => void;
  onOpenFile: (path: string, startLine?: number, endLine?: number) => void;
  onRevealInFinder?: (path: string) => void;
  // 保留 width / onWidthChange / maxWidth / onClose
}
```

组装：
1. Toolbar：`FilePathBar`（有 fileView）+ markdown 切换按钮（若 md）
2. Body 横向 flex：`FilePreview | placeholder` + 竖向 resize + `FileTree`（仅 `workdir` 存在时）
3. `useEffect`：当 `fileView.path` 变化 → `onFileTreeChange(ensureExpandedForFile(...))`

`ChatApp`：
- 传 `fileTree` / `patchGroup` 更新
- `desktopListDirResult` → 合并 cache
- `revealInFinder` → `vscode.postMessage({ command: "revealInFinder", path })`
- 树打开文件复用现有 `openFile` handler
- 可移除 toolbar 旧 `desktopOpenFileExternal` 主按钮（或保留；**spec 主路径是 reveal**——unsupported 用 reveal；路径栏不强制外部打开）

- [ ] **Step 1: 更新 filePane 测试**（null / path / unsupported / tree 请求）

- [ ] **Step 2–4: 实现组装与接线；全量相关测试 PASS；`type-check` PASS**

```bash
pnpm -F @muse-work/webview test -- tests/webview/filePane.test.tsx tests/components/fileTree.test.tsx
pnpm -F @muse-work/webview type-check
pnpm -F @muse-work/webview build
```

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/FilePathBar.tsx packages/webview/src/components/panels/FilePane.tsx packages/webview/src/components/ChatApp.tsx packages/webview/src/styles/FilePane.css packages/webview/tests/webview/filePane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): assemble file panel with path bar, preview, and tree

EOF
)"
```

---

### Task 9: 清理 hljs-only 路径 + 回归

**Files:**
- Modify: `packages/webview/src/styles/FilePane.css`（删 hljs token 色，加 shiki / tree / unsupported 样式）
- Modify: `packages/webview/src/components/panels/FilePane.tsx`（确保不再 import highlight.js）
- Modify: `packages/webview/e2e/demo/desktop-file-panel.demo.ts`（若断言旧 DOM，改为新结构）
- 检查 `highlight.js` 是否仍被 Message 等使用；**仅 FilePane 移除**，不要删依赖除非全局无引用

- [ ] **Step 1: Grep 确认**

```bash
rg "highlight\\.js|from \"highlight" packages/webview/src
```

- [ ] **Step 2: CSS / demo 更新，跑 webview + desktop 相关测试**

```bash
pnpm -F @muse-work/webview test
pnpm -F @muse-work/desktop test -- tests/filePanel.test.ts tests/fileSearch.test.ts tests/workdirHost.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -u packages/webview packages/desktop
git commit -m "$(cat <<'EOF'
chore(webview): finish file panel explorer styling and demos

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 右树虚拟列表 + vscode-icons-js | 5, 6 |
| 顶栏路径 + 图标；相对/绝对 | 5, 8 |
| Shiki github light/dark | 7 |
| Markdown preview/source 默认 preview | 7, 8 |
| 图片直接展示 | 1, 7 |
| 二进制 / >1MB + Finder reveal | 1, 2, 7 |
| gitignore + node_modules/.git | 3 |
| 树宽拖拽 min/max | 4, 6 |
| ensure-expand + 记忆状态 | 4, 6, 8 |
| 非目标未纳入 | — |
