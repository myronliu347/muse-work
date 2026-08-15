# DiffPane Revert + Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DiffPane 顶栏可一键向当前会话发送 `git commit`，并可用 discard（全部 / 单文件）经确认后丢弃工作区改动（含删除未跟踪文件）。

**Architecture:** Commit 纯 webview：`DiffPane` → `onSendMessage("git commit")` → `ChatApp.handleSendMessage`。Revert 走 desktop：`DiffPane` 确认后 `desktopRevertWorkspaceDiff` → `revertWorkspaceDiff`（`git restore` + 安全删除 untracked）→ `desktopWorkspaceDiffReverted` → 软 refresh。

**Tech Stack:** React 18、Electron main、Vitest + Testing Library、现有 `ConfirmDialog` / `codicon`、pnpm

**Spec:** `docs/superpowers/specs/2026-08-15-diff-pane-revert-design.md`

## Global Constraints

- Commit：无对话框；固定文案 `git commit`；不经 desktop `git commit`
- Revert：`ConfirmDialog`；未跟踪一并删除（仅目标 path，非 `git clean -fd`）
- 工具栏顺序：`[commit] [discard] [refresh]`
- 文件行仅 discard，无 commit
- 包管理器：pnpm；验证：`pnpm -F @muse-work/desktop test` / `pnpm -F @muse-work/webview test` + 对应 `type-check`

## File Structure

```text
packages/desktop/src/main/gitDiff.ts                 # + revertWorkspaceDiff
packages/desktop/tests/gitHelpers.test.ts            # revert 单测
packages/desktop/src/main/workdirHost.ts             # IPC 接线
packages/desktop/tests/workdirHost.test.ts           # IPC 回包
packages/webview/src/components/panels/DiffPane.tsx  # 按钮 / 确认 / 错误条
packages/webview/src/styles/DiffPane.css             # header discard 按钮
packages/webview/src/components/ChatApp.tsx          # onSendMessage
packages/webview/tests/webview/diffPane.test.tsx     # UI 行为
```

---

### Task 1: `revertWorkspaceDiff`（desktop）

**Files:**
- Modify: `packages/desktop/src/main/gitDiff.ts`
- Modify: `packages/desktop/tests/gitHelpers.test.ts`

**Interfaces:**
- Consumes: 现有 `git()` / `parsePorcelain`（可保持文件内私有；若需复用则抽到同文件 helper）
- Produces:
  - `export type RevertWorkspaceDiffResult = { ok: true } | { ok: false; error: string }`
  - `export async function revertWorkspaceDiff(cwd: string, paths?: string[]): Promise<RevertWorkspaceDiffResult>`

- [ ] **Step 1: Write the failing tests**

在 `packages/desktop/tests/gitHelpers.test.ts` 追加（复用已有 `initRepo`）：

```ts
import { revertWorkspaceDiff } from "../src/main/gitDiff.js";

describe("revertWorkspaceDiff", () => {
  it("restores a modified tracked file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
    const result = await revertWorkspaceDiff(dir, ["a.txt"]);
    expect(result).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("hello\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes an untracked file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-u-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "new.txt"), "x\n");
    const result = await revertWorkspaceDiff(dir, ["new.txt"]);
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, "new.txt"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reverts only the requested path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-1-"));
    initRepo(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "changed\n");
    fs.writeFileSync(path.join(dir, "b.txt"), "only-b\n");
    await revertWorkspaceDiff(dir, ["a.txt"]);
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("hello\n");
    expect(fs.existsSync(path.join(dir, "b.txt"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects path traversal", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-x-"));
    initRepo(dir);
    const result = await revertWorkspaceDiff(dir, ["../outside.txt"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns error for non-repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-nr-"));
    const result = await revertWorkspaceDiff(dir);
    expect(result).toEqual({ ok: false, error: "非 git 仓库" });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("no-ops ok when path set intersects nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-empty-"));
    initRepo(dir);
    const result = await revertWorkspaceDiff(dir, ["missing.txt"]);
    expect(result).toEqual({ ok: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/gitHelpers.test.ts -t revertWorkspaceDiff`

Expected: FAIL（`revertWorkspaceDiff` 未导出）

- [ ] **Step 3: Implement `revertWorkspaceDiff` in `gitDiff.ts`**

在文件末尾导出（保留现有 `getWorkspaceDiff`）。关键逻辑：

```ts
export type RevertWorkspaceDiffResult =
  | { ok: true }
  | { ok: false; error: string };

function resolveInsideRepo(repoRoot: string, rel: string): string | null {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, rel);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) return null;
  return abs;
}

export async function revertWorkspaceDiff(
  cwd: string,
  paths?: string[],
): Promise<RevertWorkspaceDiffResult> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ok: false, error: "非 git 仓库" };
  }

  const root =
    (await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "")).trim() ||
    cwd;

  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]).catch(() => "");
  let entries = parsePorcelain(status);

  if (paths && paths.length > 0) {
    const want = new Set(paths);
    entries = entries.filter((e) => want.has(e.path));
  }

  if (entries.length === 0) return { ok: true };

  const hasHead = await git(root, ["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  );

  const trackedArgs: string[] = [];
  for (const entry of entries) {
    if (entry.status === "untracked") {
      const abs = resolveInsideRepo(root, entry.path);
      if (!abs) return { ok: false, error: `非法路径：${entry.path}` };
      try {
        await fs.promises.rm(abs, { recursive: true, force: true });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      continue;
    }
    const abs = resolveInsideRepo(root, entry.path);
    if (!abs) return { ok: false, error: `非法路径：${entry.path}` };
    trackedArgs.push(entry.path);
    if (entry.oldPath) {
      const oldAbs = resolveInsideRepo(root, entry.oldPath);
      if (!oldAbs) return { ok: false, error: `非法路径：${entry.oldPath}` };
      trackedArgs.push(entry.oldPath);
    }
  }

  if (trackedArgs.length > 0) {
    const restore = hasHead
      ? ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...trackedArgs]
      : ["restore", "--staged", "--worktree", "--", ...trackedArgs];
    try {
      await git(root, restore);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { ok: true };
}
```

说明：对「仅出现在 porcelain 的路径」做 `resolveInsideRepo`；调用方传入的 `../outside` 若未出现在 porcelain，会因求交为空而 `{ ok: true }`。为让「路径穿越」测试失败语义成立，在过滤**之前**若 `paths` 中任一项 `resolveInsideRepo` 为 null，直接 `{ ok: false, error: ... }`：

```ts
  if (paths && paths.length > 0) {
    for (const p of paths) {
      if (!resolveInsideRepo(root, p)) {
        return { ok: false, error: `非法路径：${p}` };
      }
    }
    const want = new Set(paths);
    entries = entries.filter((e) => want.has(e.path));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/gitHelpers.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/gitDiff.ts packages/desktop/tests/gitHelpers.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): revert workspace diff paths via restore and delete

EOF
)"
```

---

### Task 2: `workdirHost` 接线

**Files:**
- Modify: `packages/desktop/src/main/workdirHost.ts`
- Modify: `packages/desktop/tests/workdirHost.test.ts`

**Interfaces:**
- Consumes: `revertWorkspaceDiff` from `./gitDiff.js`
- Produces: IPC `desktopRevertWorkspaceDiff` → `desktopWorkspaceDiffReverted`

- [ ] **Step 1: Write the failing host test**

在 `workdirHost.test.ts` 的 diff 相关 describe/区域追加（可复用 `desktopGetWorkspaceDiff` 测试的 repo 脚手架）：

```ts
  it("desktopRevertWorkspaceDiff replies and restores file", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-rv-"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-rv-host-"));
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n");
    execFileSync("git", ["add", "x.txt"], { cwd: dir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "i"], {
      cwd: dir,
    });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n2\n");

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
        command: "desktopRevertWorkspaceDiff",
        paneId: "p1",
        workdir: dir,
        paths: ["x.txt"],
      },
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        command: "desktopWorkspaceDiffReverted",
        paneId: "p1",
        ok: true,
      }),
    );
    expect(fs.readFileSync(path.join(dir, "x.txt"), "utf8")).toBe("1\n");

    host.dispose();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/workdirHost.test.ts -t desktopRevertWorkspaceDiff`

Expected: FAIL（无回包 / 未处理 command）

- [ ] **Step 3: Wire handler in `workdirHost.ts`**

1. Import: `import { getWorkspaceDiff, revertWorkspaceDiff } from "./gitDiff.js";`
2. 紧接 `desktopGetWorkspaceDiff` 分支后：

```ts
    if (command === "desktopRevertWorkspaceDiff") {
      const cwd =
        (typeof msg.workdir === "string" && msg.workdir) || state.workdir;
      const paths = Array.isArray(msg.paths)
        ? msg.paths.filter((p: unknown): p is string => typeof p === "string")
        : undefined;
      const result = cwd
        ? await revertWorkspaceDiff(cwd, paths)
        : ({ ok: false, error: "无法确定仓库目录" } as const);
      pushToWebview(win, {
        command: "desktopWorkspaceDiffReverted",
        paneId: msg.paneId,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @muse-work/desktop exec vitest run tests/workdirHost.test.ts -t desktopRevertWorkspaceDiff`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/workdirHost.ts packages/desktop/tests/workdirHost.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): handle desktopRevertWorkspaceDiff IPC

EOF
)"
```

---

### Task 3: DiffPane Commit 按钮 + ChatApp 接线

**Files:**
- Modify: `packages/webview/src/components/panels/DiffPane.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx`
- Modify: `packages/webview/tests/webview/diffPane.test.tsx`

**Interfaces:**
- Consumes: `handleSendMessage(text: string, ...)`
- Produces: `DiffPaneProps.onSendMessage?: (text: string) => void`

- [ ] **Step 1: Extend `renderPane` helper and write failing tests**

在 `diffPane.test.tsx` 的 `renderPane` options / JSX / `rerenderWith` 增加 `onSendMessage?: (text: string) => void`。

追加：

```ts
  it("commit button sends git commit via onSendMessage without a confirm dialog", () => {
    const onSendMessage = vi.fn();
    renderPane({ onSendMessage });
    sendDiffResult([makeFile()]);
    fireEvent.click(screen.getByTestId("diff-commit"));
    expect(onSendMessage).toHaveBeenCalledWith("git commit");
    expect(screen.queryByTestId("confirm-dialog-overlay")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "commit button"`

Expected: FAIL（无 `diff-commit`）

- [ ] **Step 3: Implement commit button + prop**

`DiffPaneProps` 增加：

```ts
  /** Sends text as a real chat message (not append-to-input). */
  onSendMessage?: (text: string) => void;
```

解构 `onSendMessage`。工具栏在 refresh 前插入：

```tsx
          <button
            type="button"
            className="preview-pane-button"
            title="提交改动"
            aria-label="提交改动"
            data-testid="diff-commit"
            onClick={() => onSendMessage?.("git commit")}
          >
            <i className="codicon codicon-git-commit" />
          </button>
```

`ChatApp` 渲染 `DiffPane` 处增加：

```tsx
          onSendMessage={(text) => handleSendMessage(text)}
```

（或 `onSendMessage={handleSendMessage}`，注意 arity 兼容即可。）

- [ ] **Step 4: Run tests**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t "commit button"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/panels/DiffPane.tsx \
  packages/webview/src/components/ChatApp.tsx \
  packages/webview/tests/webview/diffPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): DiffPane commit button sends git commit to chat

EOF
)"
```

---

### Task 4: DiffPane Revert UI（全部 + 单文件）

**Files:**
- Modify: `packages/webview/src/components/panels/DiffPane.tsx`
- Modify: `packages/webview/src/styles/DiffPane.css`
- Modify: `packages/webview/tests/webview/diffPane.test.tsx`

**Interfaces:**
- Consumes: Task 2 IPC；现有 `ConfirmDialog`
- Produces: toolbar/file discard、`pendingRevert`、`revertError`、soft refresh on success

- [ ] **Step 1: Write failing revert tests**

```ts
  describe("revert", () => {
    it("disables revert-all when there are no files", () => {
      renderPane();
      sendDiffResult([]);
      expect(screen.getByTestId("diff-revert-all")).toBeDisabled();
    });

    it("opens confirm for revert-all and posts paths on confirm", () => {
      const { vscode } = renderPane({ paneId: "p1", workdir: "/repo" });
      sendDiffResult([makeFile(), makeFile({ path: "b.ts" })], "p1");
      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("diff-revert-all"));
      expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();
      expect(screen.getByText("丢弃全部改动？")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopRevertWorkspaceDiff",
        paneId: "p1",
        workdir: "/repo",
        paths: ["src/a.ts", "b.ts"],
      });
    });

    it("cancel does not post revert", () => {
      const { vscode } = renderPane();
      sendDiffResult([makeFile()]);
      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("diff-revert-all"));
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
      expect(
        vscode.postMessage.mock.calls.some(
          ([m]) => m.command === "desktopRevertWorkspaceDiff",
        ),
      ).toBe(false);
    });

    it("file revert posts single path and does not toggle expand", () => {
      const { vscode } = renderPane({ paneId: "p1" });
      sendDiffResult([makeFile()], "p1");
      // collapse first file if needed — default expands first; click discard should not collapse via header
      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("diff-revert-file"));
      expect(screen.getByText(/丢弃「src\/a\.ts」的改动？/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopRevertWorkspaceDiff",
        paneId: "p1",
        paths: ["src/a.ts"],
      });
    });

    it("successful revert triggers a soft refresh", () => {
      const { vscode } = renderPane({ paneId: "p1" });
      sendDiffResult([makeFile()], "p1");
      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("diff-revert-all"));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      sendCommand("desktopWorkspaceDiffReverted", { paneId: "p1", ok: true });
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopGetWorkspaceDiff" }),
      );
    });

    it("failed revert shows an error bar", () => {
      renderPane({ paneId: "p1" });
      sendDiffResult([makeFile()], "p1");
      fireEvent.click(screen.getByTestId("diff-revert-all"));
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      sendCommand("desktopWorkspaceDiffReverted", {
        paneId: "p1",
        ok: false,
        error: "boom",
      });
      expect(screen.getByTestId("diff-revert-error")).toHaveTextContent("boom");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx -t revert`

Expected: FAIL

- [ ] **Step 3: Implement revert UI in `DiffPane.tsx`**

1. Import `ConfirmDialog`。
2. State：

```ts
  type PendingRevert =
    | { scope: "all" }
    | { scope: "file"; path: string };
  const [pendingRevert, setPendingRevert] = useState<PendingRevert | null>(null);
  const [reverting, setReverting] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
```

3. 在现有 `message` listener 中同时处理 `desktopWorkspaceDiffReverted`（或并列 listener）：按 `paneId` 过滤；`setReverting(false)`；`ok` → `refresh()`；否则 `setRevertError(msg.error ?? "丢弃失败")`。

4. `requestRevert(pending)` → `setPendingRevert`；确认：

```ts
  const confirmRevert = () => {
    if (!pendingRevert || state.kind !== "ok") {
      setPendingRevert(null);
      return;
    }
    const paths =
      pendingRevert.scope === "all"
        ? state.files.map((f) => f.path)
        : [pendingRevert.path];
    setPendingRevert(null);
    setReverting(true);
    setRevertError(null);
    vscode.postMessage({
      command: "desktopRevertWorkspaceDiff",
      ...(paneId ? { paneId } : {}),
      ...(workdir ? { workdir } : {}),
      paths,
    });
  };
```

5. 工具栏 discard（commit 与 refresh 之间）：

```tsx
          <button
            type="button"
            className="preview-pane-button"
            title="丢弃全部改动"
            aria-label="丢弃全部改动"
            data-testid="diff-revert-all"
            disabled={
              state.kind !== "ok" ||
              state.files.length === 0 ||
              reverting
            }
            onClick={() => setPendingRevert({ scope: "all" })}
          >
            <i className="codicon codicon-discard" />
          </button>
```

6. 文件 header：在 path 与 stats 之间插入 discard（**不要**放在外层 `<button className="diff-file-header">` 内嵌套 button——把 header 改为 `div` + 内部可点击区域，或将 discard 放在 header 外的 flex 行）。

推荐结构：

```tsx
      <div className="diff-file-header-row">
        <button className="diff-file-header" ...>…chevron status path…</button>
        <button
          type="button"
          className="diff-file-revert preview-pane-button"
          data-testid="diff-revert-file"
          data-path={file.path}
          title="丢弃此文件的改动"
          aria-label={`丢弃 ${file.path} 的改动`}
          disabled={reverting}
          onClick={() => setPendingRevert({ scope: "file", path: file.path })}
        >
          <i className="codicon codicon-discard" />
        </button>
        <span className="diff-file-stats">…</span>
      </div>
```

若保持单行视觉，用 CSS flex：`diff-file-header-row { display:flex; align-items:center; }`，`diff-file-header { flex:1; }`。

7. Body 顶部错误条：

```tsx
          {revertError && (
            <div className="diff-revert-error" data-testid="diff-revert-error">
              <span>{revertError}</span>
              <button
                type="button"
                className="preview-pane-button"
                aria-label="关闭"
                onClick={() => setRevertError(null)}
              >
                <i className="codicon codicon-close" />
              </button>
            </div>
          )}
```

8. 渲染 `ConfirmDialog`：

```tsx
      {pendingRevert && (
        <ConfirmDialog
          title={
            pendingRevert.scope === "all"
              ? "丢弃全部改动？"
              : `丢弃「${pendingRevert.path}」的改动？`
          }
          description={
            pendingRevert.scope === "all"
              ? "将恢复已跟踪文件到 HEAD，并删除未跟踪文件。此操作不可撤销。"
              : "将恢复该已跟踪文件到 HEAD；若为未跟踪则删除该文件。此操作不可撤销。"
          }
          confirmText="丢弃"
          onConfirm={confirmRevert}
          onCancel={() => setPendingRevert(null)}
        />
      )}
```

9. CSS（`DiffPane.css`）：

```css
.diff-file-header-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding-right: var(--space-2);
}

.diff-file-header-row .diff-file-header {
  flex: 1;
  min-width: 0;
}

.diff-file-revert {
  flex-shrink: 0;
}

.diff-revert-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  color: var(--red-11);
  background: var(--red-3);
  font-size: var(--font-size-1);
}
```

- [ ] **Step 4: Run DiffPane tests**

Run: `pnpm -F @muse-work/webview exec vitest run tests/webview/diffPane.test.tsx`

Expected: PASS（含既有用例；若 header 结构变更导致选择器失败，同步修正既有断言）

- [ ] **Step 5: Type-check + commit**

Run:

```bash
pnpm -F @muse-work/webview type-check
pnpm -F @muse-work/desktop type-check
```

Expected: 无错误

```bash
git add packages/webview/src/components/panels/DiffPane.tsx \
  packages/webview/src/styles/DiffPane.css \
  packages/webview/tests/webview/diffPane.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): DiffPane discard all/file with confirm and host revert

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| 顶栏 commit → 发送 `git commit` | 3 |
| 顶栏 discard 全部 + ConfirmDialog | 4 |
| 文件行 discard | 4 |
| 未跟踪删除 + restore | 1 |
| 路径安全 | 1 |
| IPC 协议 | 2 |
| 成功 soft refresh / 失败错误条 | 4 |
| ChatApp `onSendMessage` | 3 |
| 非目标（本机 commit、行级 discard 等） | 不实现 |

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-15-diff-pane-revert-commit.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 每任务新开 subagent，任务间审查  

**2. Inline Execution** — 本会话按 executing-plans 连续做，带检查点  

Which approach?
