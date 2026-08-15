# Diff Pane UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 变更面板：状态改图标、路径可点开文件面板、用 `@pierre/diffs` 的 `PatchDiff` 渲染并保留行内评论。

**Architecture:** 前端 `toPierrePatch` 把 host 的截断 hunks 合成完整 unified patch；`DiffPane` 保留自有 accordion header，展开体挂 `PatchDiff`（`disableFileHeader` + `disableWorkerPool`）；行内评论经 `renderGutterUtility` / `lineAnnotations` / `renderAnnotation` 接回现有 `formatDiffComment` → `onAddComment`。单元测试 mock `@pierre/diffs/react`，避免 jsdom 跑 Shiki/worker。

**Tech Stack:** React 18、`@pierre/diffs`、Vitest + Testing Library、现有 `codicon`、pnpm

**Spec:** `docs/superpowers/specs/2026-08-15-diff-pane-ui-polish-design.md`

## Global Constraints

- 仅改 `DiffPane` + `ChatApp` 传 `onOpenFile`；不改消息 `DiffViewer`、不改 `gitDiff.ts` hunks 协议
- Diff 库：`@pierre/diffs`（已在 `packages/webview/package.json`）
- 行内评论必须保留；路径点击只打开文件、不 toggle 展开
- `PatchDiff` options：`diffStyle: 'unified'`、`disableFileHeader: true`、`lineDiffType: 'word'`、`overflow: 'scroll'`、`enableGutterUtility: true`、`theme: { dark: 'pierre-dark', light: 'pierre-light' }`；webview IIFE 传 `disableWorkerPool`
- 包管理器：pnpm；验证：`pnpm -F @muse-work/webview test` + `type-check`

## File Structure

```text
packages/webview/src/utils/toPierrePatch.ts          # patch 合成 + 行文本解析
packages/webview/tests/muse/toPierrePatch.test.ts    # 工具单测
packages/webview/src/components/panels/DiffPane.tsx  # 图标 / 路径 / PatchDiff / 评论
packages/webview/src/styles/DiffPane.css             # status icon + path link
packages/webview/src/components/ChatApp.tsx          # onOpenFile={handleOpenFile}
packages/webview/tests/webview/diffPane.test.tsx     # UI / 评论 / mock PatchDiff
packages/webview/e2e/demo/desktop-diff-comments.demo.ts  # 若 selector 变则更新
```

---

### Task 1: `toPierrePatch` + `resolveDiffLineText`

**Files:**
- Create: `packages/webview/src/utils/toPierrePatch.ts`
- Create: `packages/webview/tests/muse/toPierrePatch.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export type PierrePatchInput = { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'; oldPath?: string; hunks: string; binary: boolean }`
  - `export function toPierrePatch(file: PierrePatchInput): string | null`
  - `export function resolveDiffLineText(patch: string, side: 'additions' | 'deletions', lineNumber: number): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toPierrePatch, resolveDiffLineText } from "../../src/utils/toPierrePatch";

const base = {
  path: "src/a.ts",
  status: "modified" as const,
  hunks: "@@ -1 +1 @@\n-old\n+new",
  binary: false,
};

describe("toPierrePatch", () => {
  it("returns null for binary or empty hunks", () => {
    expect(toPierrePatch({ ...base, binary: true })).toBeNull();
    expect(toPierrePatch({ ...base, hunks: "" })).toBeNull();
  });

  it("wraps tracked hunks with ---/+++ headers", () => {
    expect(toPierrePatch(base)).toBe(
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
    );
  });

  it("uses /dev/null for added and deleted", () => {
    expect(toPierrePatch({ ...base, status: "added" })).toContain(
      "--- /dev/null\n+++ b/src/a.ts\n",
    );
    expect(toPierrePatch({ ...base, status: "deleted" })).toContain(
      "--- a/src/a.ts\n+++ /dev/null\n",
    );
  });

  it("uses oldPath for renamed", () => {
    expect(
      toPierrePatch({
        ...base,
        status: "renamed",
        oldPath: "src/old.ts",
        path: "src/new.ts",
      }),
    ).toContain("--- a/src/old.ts\n+++ b/src/new.ts\n");
  });

  it("synthesizes hunk header for untracked +only lines", () => {
    const patch = toPierrePatch({
      path: "new.txt",
      status: "untracked",
      hunks: "+a\n+b",
      binary: false,
    });
    expect(patch).toBe(
      "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b",
    );
  });
});

describe("resolveDiffLineText", () => {
  it("resolves addition/deletion line text by 1-based file line number", () => {
    const patch =
      "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new";
    expect(resolveDiffLineText(patch, "deletions", 1)).toBe("old");
    expect(resolveDiffLineText(patch, "additions", 1)).toBe("new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/muse/toPierrePatch.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```ts
import { parsePatchFiles } from "@pierre/diffs";

export type PierrePatchInput = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
  hunks: string;
  binary: boolean;
};

export function toPierrePatch(file: PierrePatchInput): string | null {
  if (file.binary || !file.hunks.trim()) return null;

  if (file.status === "untracked" && !file.hunks.includes("@@")) {
    const lines = file.hunks.split("\n").filter((l) => l.startsWith("+"));
    const n = lines.length;
    return [
      "--- /dev/null",
      `+++ b/${file.path}`,
      `@@ -0,0 +1,${n} @@`,
      ...lines,
    ].join("\n");
  }

  const oldPath =
    file.status === "added"
      ? "/dev/null"
      : `a/${file.oldPath ?? file.path}`;
  const newPath =
    file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
  const oldHeader = oldPath === "/dev/null" ? "--- /dev/null" : `--- ${oldPath}`;
  const newHeader = newPath === "/dev/null" ? "+++ /dev/null" : `+++ ${newPath}`;
  return `${oldHeader}\n${newHeader}\n${file.hunks}`;
}

export function resolveDiffLineText(
  patch: string,
  side: "additions" | "deletions",
  lineNumber: number,
): string {
  const meta = parsePatchFiles(patch)[0]?.files[0];
  if (!meta) return "";
  for (const hunk of meta.hunks) {
    if (side === "additions") {
      const start = hunk.additionStart;
      const count = hunk.additionCount;
      if (lineNumber >= start && lineNumber < start + count) {
        const idx = hunk.additionLineIndex + (lineNumber - start);
        return (meta.additionLines[idx] ?? "").replace(/\n$/, "");
      }
    } else {
      const start = hunk.deletionStart;
      const count = hunk.deletionCount;
      if (lineNumber >= start && lineNumber < start + count) {
        const idx = hunk.deletionLineIndex + (lineNumber - start);
        return (meta.deletionLines[idx] ?? "").replace(/\n$/, "");
      }
    }
  }
  return "";
}
```

若 `parsePatchFiles` 字段名与上略有出入，以 `FileDiffMetadata` / `HunkData` 实际类型为准微调，保持测试通过。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/webview exec vitest run tests/muse/toPierrePatch.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/utils/toPierrePatch.ts packages/webview/tests/muse/toPierrePatch.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add toPierrePatch helpers for DiffPane

EOF
)"
```

---

### Task 2: 状态图标

**Files:**
- Modify: `packages/webview/src/components/panels/DiffPane.tsx`
- Modify: `packages/webview/src/styles/DiffPane.css`
- Modify: `packages/webview/tests/webview/diffPane.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: header 内 `STATUS_ICON` / `STATUS_LABEL` 映射（label 仅用于 `title`/`aria-label`）

- [ ] **Step 1: Update failing assertion**

把 `renders file blocks with status, path and +/- stats` 中：

```ts
expect(screen.getByText("修改")).toBeInTheDocument();
expect(screen.getByText("新增")).toBeInTheDocument();
```

改为：

```ts
expect(
  screen.getByTestId("diff-file-modified").querySelector(".codicon-diff-modified"),
).not.toBeNull();
expect(
  screen.getByTestId("diff-file-added").querySelector(".codicon-diff-added"),
).not.toBeNull();
expect(screen.queryByText("修改")).not.toBeInTheDocument();
expect(screen.queryByText("新增")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "renders file blocks"`

Expected: FAIL（仍是文字 pill）

- [ ] **Step 3: Implement icons + CSS**

在 `DiffPane.tsx`：

```ts
const STATUS_ICON: Record<WorkspaceFileStatus, string> = {
  added: "codicon-diff-added",
  modified: "codicon-diff-modified",
  deleted: "codicon-diff-removed",
  renamed: "codicon-diff-renamed",
  untracked: "codicon-diff-added",
};
```

把 status `<span>{STATUS_LABEL[...]}</span>` 换成：

```tsx
<span
  className={`diff-file-status diff-file-status-${file.status}`}
  title={STATUS_LABEL[file.status]}
  aria-label={STATUS_LABEL[file.status]}
>
  <i className={`codicon ${STATUS_ICON[file.status]}`} />
</span>
```

CSS：去掉 status 的 `border` / `padding` pill；保留颜色类；图标 `font-size` 与 header 对齐。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "renders file blocks"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/DiffPane.tsx packages/webview/src/styles/DiffPane.css packages/webview/tests/webview/diffPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): show DiffPane file status as icons

EOF
)"
```

---

### Task 3: 可点路径 + `onOpenFile`

**Files:**
- Modify: `packages/webview/src/components/panels/DiffPane.tsx`
- Modify: `packages/webview/src/styles/DiffPane.css`
- Modify: `packages/webview/src/components/ChatApp.tsx`（`DiffPane` 调用处约 L1995）
- Modify: `packages/webview/tests/webview/diffPane.test.tsx`

**Interfaces:**
- Consumes: `ChatApp.handleOpenFile(path, startLine?, endLine?)`
- Produces: `DiffPaneProps.onOpenFile?: (path: string) => void`

- [ ] **Step 1: Write the failing test**

扩展 `renderPane` 支持 `onOpenFile`，并追加：

```ts
it("clicking the path opens the file without toggling expand", () => {
  const onOpenFile = vi.fn();
  const { container } = renderPane({ onOpenFile });
  sendDiffResult([makeFile()]);
  const header = container.querySelector(".diff-file-header") as HTMLElement;
  expect(header).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByTestId("diff-file-path"));
  expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
  expect(header).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "clicking the path"`

Expected: FAIL（无 `diff-file-path` testid / 未调用）

- [ ] **Step 3: Implement**

`DiffPaneProps` 增加 `onOpenFile?: (path: string) => void`；解构传入。

Header 内 path：

```tsx
<span
  className="diff-file-path"
  data-testid="diff-file-path"
  role="link"
  tabIndex={0}
  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
  onClick={(e) => {
    e.stopPropagation();
    onOpenFile?.(file.path);
  }}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onOpenFile?.(file.path);
    }
  }}
>
  {file.path}
</span>
```

CSS：`.diff-file-path` 用 `var(--accent-11)`；`:hover` underline。

`ChatApp`：

```tsx
<DiffPane
  ...
  onOpenFile={handleOpenFile}
  onAddComment={handleAddComment}
  {...common}
/>
```

- [ ] **Step 4: Run tests**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "clicking the path|collapses and expands"`

Expected: PASS（点 path 不收起；点 header 仍 toggle）

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/DiffPane.tsx packages/webview/src/styles/DiffPane.css packages/webview/src/components/ChatApp.tsx packages/webview/tests/webview/diffPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): open file panel from DiffPane path click

EOF
)"
```

---

### Task 4: `PatchDiff` 渲染 + 行内评论

**Files:**
- Modify: `packages/webview/src/components/panels/DiffPane.tsx`（删除自研 `renderHunks` / `renderWordLevelDiff` 导入）
- Modify: `packages/webview/tests/webview/diffPane.test.tsx`（mock Pierre；改写 hunk/评论断言）
- Modify: `packages/webview/e2e/demo/desktop-diff-comments.demo.ts`（如仍找旧 `diff-comment-add-N`）

**Interfaces:**
- Consumes: `toPierrePatch`、`resolveDiffLineText`、`formatDiffComment`
- Produces: 展开体 `PatchDiff`；评论 `CommentTarget = { file, side, lineNumber, prefix, text }`

- [ ] **Step 1: Add mock + rewrite failing tests**

在 `diffPane.test.tsx` 顶部：

```ts
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({
    patch,
    lineAnnotations,
    renderGutterUtility,
    renderAnnotation,
  }: {
    patch: string;
    lineAnnotations?: { side: "additions" | "deletions"; lineNumber: number }[];
    renderGutterUtility?: (
      getHoveredLine: () =>
        | { lineNumber: number; side: "additions" | "deletions" }
        | undefined,
    ) => React.ReactNode;
    renderAnnotation?: (ann: {
      side: "additions" | "deletions";
      lineNumber: number;
    }) => React.ReactNode;
  }) => (
    <div data-testid="pierre-patch-diff" data-patch={patch}>
      {renderGutterUtility?.(() => ({
        side: "additions",
        lineNumber: 1,
      }))}
      {(lineAnnotations ?? []).map((ann) => (
        <div key={`${ann.side}-${ann.lineNumber}`}>
          {renderAnnotation?.(ann)}
        </div>
      ))}
    </div>
  ),
}));
```

删除/改写依赖 `.diff-line-*` / `.diff-word-*` / `diff-comment-add-N` 的用例：

- hunk/word-level 系列 → 断言 `pierre-patch-diff` 存在且 `data-patch` 含 `--- a/src/a.ts` 与 `+new1`
- 评论系列：按钮 `data-testid="diff-comment-add"`；点击后出现 `diff-comment-box`；提交仍期望 `formatDiffComment` 字符串（prefix `+`，text 来自 `resolveDiffLineText`，对 `makeFile()` 的 `+new1` 应为 `new1`）

- [ ] **Step 2: Run comment/hunk tests — expect FAIL**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "pierre|comment|hunk|word"`

Expected: FAIL（尚未挂 PatchDiff / 旧 DOM）

- [ ] **Step 3: Implement DiffPane body**

1. `import { PatchDiff } from "@pierre/diffs/react"`
2. `import { toPierrePatch, resolveDiffLineText } from "../../utils/toPierrePatch"`
3. 删除 `renderWordLevelDiff` 与整段 `renderHunks`
4. `CommentTarget`：

```ts
interface CommentTarget {
  file: WorkspaceDiffFile;
  side: "additions" | "deletions";
  lineNumber: number;
  prefix: string;
  text: string;
}
```

5. 展开体：

```tsx
{file.binary ? (
  <div className="diff-line-ellipsis">二进制文件，不显示差异</div>
) : (() => {
  const patch = toPierrePatch(file);
  if (!patch) {
    return (
      <div className="diff-line-ellipsis">
        {file.status === "renamed" && file.oldPath
          ? `重命名自 ${file.oldPath}`
          : "无内容差异"}
      </div>
    );
  }
  const lineAnnotations =
    commentTarget?.file.path === file.path
      ? [
          {
            side: commentTarget.side,
            lineNumber: commentTarget.lineNumber,
          },
        ]
      : [];
  return (
    <PatchDiff
      patch={patch}
      disableWorkerPool
      options={{
        diffStyle: "unified",
        disableFileHeader: true,
        lineDiffType: "word",
        overflow: "scroll",
        enableGutterUtility: true,
        theme: { dark: "pierre-dark", light: "pierre-light" },
      }}
      lineAnnotations={lineAnnotations}
      renderGutterUtility={(getHoveredLine) => (
        <button
          type="button"
          className="diff-line-comment-btn"
          data-testid="diff-comment-add"
          title="评论这行"
          aria-label="评论这行"
          onClick={() => {
            const hovered = getHoveredLine();
            if (!hovered) return;
            const prefix = hovered.side === "additions" ? "+" : "-";
            const text = resolveDiffLineText(
              patch,
              hovered.side,
              hovered.lineNumber,
            ).slice(0, 30);
            setCommentTarget({
              file,
              side: hovered.side,
              lineNumber: hovered.lineNumber,
              prefix,
              text,
            });
          }}
        >
          <i className="codicon codicon-add" />
        </button>
      )}
      renderAnnotation={() =>
        commentTarget?.file.path === file.path ? (
          // 复用现有 diff-comment-box JSX（textarea / 取消 / 添加 / IME）
          <CommentBox ... />
        ) : null
      }
    />
  );
})()}
{file.truncated && (
  <div className="diff-line-ellipsis">差异过大，已截断…</div>
)}
```

将评论框抽成组件内函数或内联保持与现逻辑一致（Enter / Esc / IME / disabled）。

6. 若 Pierre React 的 `renderGutterUtility` 要 DOM 节点而非 ReactNode，按 `PatchDiff` 实际类型用 `useCallback` + portal/wrapper；以类型与 mock 为准。

7. CSS：`.diff-pane [data-testid="pierre-patch-diff"]` 或 Pierre 根节点 scoped，避免撑破面板；评论按钮样式可复用 `.diff-line-comment-btn`（若 Pierre 槽位自带显隐，可简化 hover CSS）。

- [ ] **Step 4: Run DiffPane tests**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx`

Expected: PASS

- [ ] **Step 5: Update e2e demo selector if needed**

`desktop-diff-comments.demo.ts`：若仍点 `diff-comment-add-${idx}`，改为悬停行后点 `diff-comment-add`（或文档说明 demo 需人工刷新截图）。至少保证 testid 存在。

- [ ] **Step 6: Commit**

```bash
git add packages/webview/src/components/panels/DiffPane.tsx packages/webview/src/styles/DiffPane.css packages/webview/tests/webview/diffPane.test.tsx packages/webview/e2e/demo/desktop-diff-comments.demo.ts
git commit -m "$(cat <<'EOF'
feat(webview): render DiffPane hunks with @pierre/diffs

Preserve inline line comments via gutter + annotations.
EOF
)"
```

---

### Task 5: 全量验证

**Files:** 无新文件（修编译/测试残留）

- [ ] **Step 1: type-check**

Run: `pnpm -F @muse-work/webview type-check`

Expected: exit 0

- [ ] **Step 2: full webview tests**

Run: `pnpm -F @muse-work/webview test`

Expected: PASS（或仅与本改动无关的既有失败需另报，不得引入新失败）

- [ ] **Step 3: build smoke**

Run: `pnpm -F @muse-work/webview build`

Expected: 成功产出 `dist/chat.js`（确认 `@pierre/diffs` 被 esbuild 打进 bundle，无 worker 路径报错）

- [ ] **Step 4: Commit only if Step 1–3 产生修复**

```bash
git add -A
git status
# 若有修复：
git commit -m "$(cat <<'EOF'
fix(webview): settle DiffPane Pierre integration build/tests

EOF
)"
```

若 working tree 干净则跳过 commit。

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 状态图标 | Task 2 |
| 路径点击 + `onOpenFile` | Task 3 |
| `toPierrePatch` 合成规则 | Task 1 |
| `PatchDiff` options / 主题 | Task 4 |
| 行内评论保留 | Task 4 |
| 不改 DiffViewer / gitDiff | 全局约束 |
| 单测 + e2e selector | Task 1/4/5 |
