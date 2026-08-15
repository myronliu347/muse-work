# Sender Local File Pick / Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop sender can pick multiple local files via OS dialog and paste non-image local files into the composer as `@file` ContextTags (images stay attachments).

**Architecture:** Electron `showOpenDialog` (`openFile` + `multiSelections`) returns absolute paths over IPC; webview maps paths to `FileItem` (workdir-relative when under workdir) and reuses `insertFileMentionAtCursor`. Paste inspects clipboard `File.path` / `text/uri-list` before the existing image/text branches. `hostBridge` already mirrors every `postMessage` to Electron, so only `workdirHost` needs a new handler.

**Tech Stack:** Electron `dialog`, React MessageInput, Vitest + Testing Library (jsdom), existing ContextTag / `toRelativePath`

**Spec:** `docs/superpowers/specs/2026-08-15-sender-local-file-pick-design.md`

## Global Constraints

- Insert `@file` only — do not upload non-image file bytes
- Images always → AttachedImages (path-backed image file with File blob, or pathless screenshot)
- Multi-file; no directory pick; skip paste paths that end with `/` or `\`
- `@` suggestion dropdown unchanged (workdir search only)
- Desktop only for the toolbar button (`enableLocalFilePick`); paste `@file` only when a real absolute path is available
- Reuse `insertFileMentionAtCursor`; path display via `toRelativePath` semantics
- Tests: `/** @vitest-environment jsdom */` for webview component tests; desktop package vitest for host
- UI: `codicon-new-file`, Tooltip「添加文件」, reuse `.toolbar-icon-button`

## File Structure

```text
packages/webview/src/utils/localFileMention.ts          # path → FileItem; clipboard parse; image ext
packages/webview/tests/muse/localFileMention.test.ts    # util unit tests
packages/desktop/src/main/workdirHost.ts                # desktopSelectFiles handler
packages/desktop/tests/workdirHost.test.ts              # dialog params + result / cancel
packages/webview/src/types/index.ts                     # MessageInputProps.enableLocalFilePick
packages/webview/src/components/chat/MessageInput.tsx   # button, result listener, paste branch
packages/webview/src/components/ChatApp.tsx             # pass enableLocalFilePick={isDesktop}
packages/webview/src/styles/MessageInput.css            # disabled state for toolbar-icon-button if missing
packages/webview/tests/components/messageInput.localFiles.test.tsx
```

---

### Task 1: `localFileMention` utils (TDD)

**Files:**
- Create: `packages/webview/src/utils/localFileMention.ts`
- Test: `packages/webview/tests/muse/localFileMention.test.ts`

**Interfaces:**
- Consumes: `toRelativePath` from `./messageUtils`
- Produces:
  - `isImageFileName(name: string): boolean` — true for png/jpg/jpeg/gif/webp/svg (case-insensitive)
  - `fileItemFromAbsolutePath(absolutePath: string, workdir?: string): FileItem`
  - `parseFileUriList(uriList: string): string[]` — decode `file://` lines, ignore non-file URIs / blanks
  - `parseClipboardLocalFiles(clipboardData: DataTransfer | null | undefined): Array<{ absolutePath: string; file?: File; isImage: boolean }>`

- [ ] **Step 1: Write the failing test**

```ts
/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  fileItemFromAbsolutePath,
  isImageFileName,
  parseClipboardLocalFiles,
  parseFileUriList,
} from "../../src/utils/localFileMention";

describe("localFileMention", () => {
  it("isImageFileName matches common image extensions", () => {
    expect(isImageFileName("a.PNG")).toBe(true);
    expect(isImageFileName("b.ts")).toBe(false);
  });

  it("fileItemFromAbsolutePath uses relative path under workdir", () => {
    const item = fileItemFromAbsolutePath(
      "/proj/src/a.ts",
      "/proj",
    );
    expect(item).toMatchObject({
      path: "/proj/src/a.ts",
      relativePath: "src/a.ts",
      name: "a.ts",
      isDirectory: false,
      extension: "ts",
    });
    expect(item.icon).toBeTruthy();
  });

  it("fileItemFromAbsolutePath keeps absolute path outside workdir", () => {
    const item = fileItemFromAbsolutePath("/tmp/out.md", "/proj");
    expect(item.relativePath).toBe("/tmp/out.md");
    expect(item.name).toBe("out.md");
  });

  it("parseFileUriList decodes file:// URIs", () => {
    expect(
      parseFileUriList("file:///tmp/a.ts\nfile:///tmp/b%20c.md\nhttps://x"),
    ).toEqual(["/tmp/a.ts", "/tmp/b c.md"]);
  });

  it("parseClipboardLocalFiles prefers File.path and skips directory-looking paths", () => {
    const file = new File([""], "note.md", { type: "text/markdown" });
    Object.defineProperty(file, "path", { value: "/tmp/note.md" });
    const dt = {
      items: [
        {
          kind: "file",
          type: "text/markdown",
          getAsFile: () => file,
        },
      ],
      files: [file],
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(parseClipboardLocalFiles(dt)).toEqual([
      { absolutePath: "/tmp/note.md", file, isImage: false },
    ]);

    const dirPath = "/tmp/folder/";
    const uriDt = {
      items: [],
      files: [],
      types: ["text/uri-list"],
      getData: (t: string) => (t === "text/uri-list" ? `file://${dirPath}` : ""),
    } as unknown as DataTransfer;
    expect(parseClipboardLocalFiles(uriDt)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/webview && npx vitest run tests/muse/localFileMention.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/webview/src/utils/localFileMention.ts
import type { FileItem } from "../types";
import { toRelativePath } from "./messageUtils";

const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

export function isImageFileName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

export function fileItemFromAbsolutePath(
  absolutePath: string,
  workdir?: string,
): FileItem {
  const normalized = absolutePath.replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).pop() || absolutePath;
  const relativePath = toRelativePath(absolutePath, workdir);
  const dot = name.lastIndexOf(".");
  const extension =
    !name.startsWith(".") && dot > 0 ? name.slice(dot + 1) : "";
  return {
    path: absolutePath,
    relativePath,
    name,
    extension,
    icon: "codicon-file",
    isDirectory: false,
  };
}

export function parseFileUriList(uriList: string): string[] {
  const out: string[] = [];
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.toLowerCase().startsWith("file:")) continue;
    try {
      const u = new URL(trimmed);
      let p = decodeURIComponent(u.pathname);
      // file:///C:/... on Windows → /C:/... ; strip leading slash before drive
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      out.push(p);
    } catch {
      // skip
    }
  }
  return out;
}

function looksLikeDirectoryPath(p: string): boolean {
  return /[/\\]$/.test(p);
}

export function parseClipboardLocalFiles(
  clipboardData: DataTransfer | null | undefined,
): Array<{ absolutePath: string; file?: File; isImage: boolean }> {
  if (!clipboardData) return [];
  const byPath = new Map<
    string,
    { absolutePath: string; file?: File; isImage: boolean }
  >();

  const files = clipboardData.files;
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const abs =
        typeof (file as File & { path?: string }).path === "string"
          ? (file as File & { path?: string }).path!
          : "";
      if (!abs || looksLikeDirectoryPath(abs)) continue;
      byPath.set(abs, {
        absolutePath: abs,
        file,
        isImage: isImageFileName(file.name || abs),
      });
    }
  }

  if (byPath.size === 0) {
    const uriList = clipboardData.getData?.("text/uri-list") || "";
    for (const abs of parseFileUriList(uriList)) {
      if (looksLikeDirectoryPath(abs)) continue;
      const name = abs.replace(/\\/g, "/").split("/").pop() || abs;
      byPath.set(abs, {
        absolutePath: abs,
        isImage: isImageFileName(name),
      });
    }
  }

  return [...byPath.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/webview && npx vitest run tests/muse/localFileMention.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/utils/localFileMention.ts \
  packages/webview/tests/muse/localFileMention.test.ts
git commit -m "$(cat <<'EOF'
feat(webview): add local file mention path helpers

EOF
)"
```

---

### Task 2: `workdirHost` — `desktopSelectFiles` (TDD)

**Files:**
- Modify: `packages/desktop/src/main/workdirHost.ts`
- Test: `packages/desktop/tests/workdirHost.test.ts`

**Interfaces:**
- Consumes: existing `showOpenDialog`, `pushToWebview`, `state.workdir`
- Produces: IPC `desktopSelectFiles` → on confirm `desktopSelectFilesResult { paths: string[] }`; cancel / empty → no push

- [ ] **Step 1: Write the failing test**

Append to `packages/desktop/tests/workdirHost.test.ts`:

```ts
  it("desktopSelectFiles opens multi file dialog and pushes paths", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "muse-wd-files-"));
    const sent: unknown[] = [];
    let handler:
      | ((event: { sender: unknown }, raw: unknown) => void | Promise<void>)
      | undefined;
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ["/tmp/a.ts", "/tmp/b.md"],
    }));

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
      defaultWorkdir: "/proj",
      ipc: {
        on: (_channel, listener) => {
          handler = listener as typeof handler;
        },
        removeListener: () => {},
      },
      fromWebContents: () => fakeWin as never,
      showOpenDialog,
    });

    await handler!({ sender: {} }, { command: "desktopSelectFiles" });

    expect(showOpenDialog).toHaveBeenCalledWith(
      fakeWin,
      expect.objectContaining({
        properties: expect.arrayContaining(["openFile", "multiSelections"]),
        defaultPath: "/proj",
      }),
    );
    expect(sent).toContainEqual({
      command: "desktopSelectFilesResult",
      paths: ["/tmp/a.ts", "/tmp/b.md"],
    });

    sent.length = 0;
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await handler!({ sender: {} }, { command: "desktopSelectFiles" });
    expect(sent).toEqual([]);

    (host as { dispose: () => void }).dispose();
    fs.rmSync(userData, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && npx vitest run tests/workdirHost.test.ts -t desktopSelectFiles`

Expected: FAIL (no result / dialog not called with those props)

- [ ] **Step 3: Write minimal implementation**

In `workdirHost.ts` handler, after `desktopSelectWorkdir` block (or nearby desktop* commands):

```ts
    if (command === "desktopSelectFiles") {
      if (!win) return;
      const result = await showOpenDialog(win, {
        properties: ["openFile", "multiSelections"],
        defaultPath: state.workdir,
      });
      if (result.canceled || !result.filePaths?.length) return;
      pushToWebview(win, {
        command: "desktopSelectFilesResult",
        paths: result.filePaths,
      });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && npx vitest run tests/workdirHost.test.ts -t desktopSelectFiles`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/workdirHost.ts \
  packages/desktop/tests/workdirHost.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): IPC desktopSelectFiles for sender file pick

EOF
)"
```

---

### Task 3: MessageInput — add-file button + result → `@file` (TDD)

**Files:**
- Modify: `packages/webview/src/types/index.ts` (`MessageInputProps`)
- Modify: `packages/webview/src/components/chat/MessageInput.tsx`
- Modify: `packages/webview/src/components/ChatApp.tsx` (pass `enableLocalFilePick`)
- Modify: `packages/webview/src/styles/MessageInput.css` (disabled style if needed)
- Test: `packages/webview/tests/components/messageInput.localFiles.test.tsx`

**Interfaces:**
- Consumes: `fileItemFromAbsolutePath`, `insertFileMentionAtCursor`, `vscode.postMessage`, prop `enableLocalFilePick?: boolean`, prop `workdir?: string`
- Produces: button `data-testid="add-local-file-btn"`; on `desktopSelectFilesResult` inserts tags

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MessageInput } from "../../src/components/chat/MessageInput";
import type { VsCodeApi } from "../../src/types";

vi.mock("../../src/styles/MessageInput.css", () => ({}));
vi.mock("../../src/styles/AttachedImages.css", () => ({}));

function stubVscode(): VsCodeApi {
  return {
    postMessage: vi.fn(),
    getState: () => null,
    setState: () => {},
  };
}

describe("MessageInput local file pick", () => {
  afterEach(() => cleanup());

  it("shows add-file button only when enableLocalFilePick", () => {
    const vscode = stubVscode();
    const { rerender } = render(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
        enableLocalFilePick
      />,
    );
    expect(screen.getByTestId("add-local-file-btn")).toBeTruthy();
    rerender(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
      />,
    );
    expect(screen.queryByTestId("add-local-file-btn")).toBeNull();
  });

  it("click posts desktopSelectFiles; result inserts @file tags", async () => {
    const vscode = stubVscode();
    render(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
        enableLocalFilePick
        workdir="/proj"
      />,
    );
    fireEvent.click(screen.getByTestId("add-local-file-btn"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectFiles",
    });

    const input = screen.getByTestId("message-input");
    input.focus();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "desktopSelectFilesResult",
            paths: ["/proj/src/a.ts", "/tmp/out.md"],
          },
        }),
      );
    });
    expect(input.innerHTML).toContain("[@file:src/a.ts]");
    expect(input.innerHTML).toContain("[@file:/tmp/out.md]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/webview && npx vitest run tests/components/messageInput.localFiles.test.tsx`

Expected: FAIL (no button / no tags)

- [ ] **Step 3: Write minimal implementation**

1. Add to `MessageInputProps`:

```ts
  /** Desktop: show toolbar button to pick local files via OS dialog. */
  enableLocalFilePick?: boolean;
```

2. In `MessageInput`, destructure `enableLocalFilePick`. Import `fileItemFromAbsolutePath` and `Tooltip` (already used).

3. In the existing `window` message listener (same place as `fileSuggestionsResponse`), add:

```ts
        } else if (data.command === "desktopSelectFilesResult") {
          const paths = Array.isArray(data.paths) ? data.paths : [];
          for (const p of paths) {
            if (typeof p !== "string" || !p) continue;
            insertFileMentionAtCursor(fileItemFromAbsolutePath(p, workdir));
          }
        }
```

Ensure `insertFileMentionAtCursor` and `workdir` are in the effect dependency list (or use refs if the existing pattern does — follow the file's current style for `insertSelectionTag`).

4. Toolbar left cluster — replace the workdir-only gate:

```tsx
              {enableLocalFilePick || workdirSelector ? (
                <div
                  className="input-toolbar-left"
                  data-testid="input-workdir-row"
                >
                  {workdirSelector}
                  {enableLocalFilePick ? (
                    <Tooltip text="添加文件" position="top">
                      <button
                        type="button"
                        className="toolbar-icon-button"
                        data-testid="add-local-file-btn"
                        aria-label="添加文件"
                        disabled={disabled}
                        onClick={() =>
                          vscode.postMessage({ command: "desktopSelectFiles" })
                        }
                      >
                        <i className="codicon codicon-new-file" />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              ) : null}
```

5. In `ChatApp` MessageInput props:

```tsx
      enableLocalFilePick={isDesktop}
```

6. CSS — add if missing:

```css
.toolbar-icon-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.toolbar-icon-button:disabled:hover {
  background-color: transparent;
  color: var(--gray-11);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/webview && npx vitest run tests/components/messageInput.localFiles.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/types/index.ts \
  packages/webview/src/components/chat/MessageInput.tsx \
  packages/webview/src/components/ChatApp.tsx \
  packages/webview/src/styles/MessageInput.css \
  packages/webview/tests/components/messageInput.localFiles.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): sender button to pick local files as @file

EOF
)"
```

---

### Task 4: MessageInput — paste local non-image files → `@file` (TDD)

**Files:**
- Modify: `packages/webview/src/components/chat/MessageInput.tsx` (`handlePaste`)
- Test: `packages/webview/tests/components/messageInput.localFiles.test.tsx` (extend)
- Keep regression: `packages/webview/tests/components/messageInput.pasteImages.test.tsx`

**Interfaces:**
- Consumes: `parseClipboardLocalFiles`, `fileItemFromAbsolutePath`, `handleImagePaste`, `insertFileMentionAtCursor`
- Produces: paste order per spec — Selection MIME → local files split → pathless images → text

- [ ] **Step 1: Write the failing tests**

Append to `messageInput.localFiles.test.tsx`:

```tsx
  it("pastes non-image local file as @file; image file with blob as attachment", async () => {
    const vscode = stubVscode();
    render(
      <MessageInput
        onSendMessage={vi.fn()}
        isStreaming={false}
        onAbortMessage={vi.fn()}
        vscode={vscode}
        enableLocalFilePick
        workdir="/proj"
      />,
    );
    const input = screen.getByTestId("message-input");
    input.focus();

    const md = new File(["x"], "note.md", { type: "text/markdown" });
    Object.defineProperty(md, "path", { value: "/proj/note.md" });
    const png = new File(
      [Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))],
      "shot.png",
      { type: "image/png" },
    );
    Object.defineProperty(png, "path", { value: "/tmp/shot.png" });

    const items = [
      { type: "text/markdown", getAsFile: () => md },
      { type: "image/png", getAsFile: () => png },
    ];
    const clipboardData = {
      items,
      files: [md, png],
      types: ["Files"],
      getData: () => "",
    };

    await act(async () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      input.dispatchEvent(event);
    });

    expect(input.innerHTML).toContain("[@file:note.md]");
    await waitFor(() => {
      expect(screen.getByTestId("attached-images")).toBeTruthy();
    });
  });
```

(Import `waitFor` from Testing Library.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/webview && npx vitest run tests/components/messageInput.localFiles.test.tsx`

Expected: FAIL (paste still treats only images / ignores File.path)

- [ ] **Step 3: Write minimal implementation**

In `handlePaste`, after Selection MIME handling and **before** the existing `image/*` loop:

```ts
        const localFiles = parseClipboardLocalFiles(event.clipboardData);
        if (localFiles.length > 0) {
          event.preventDefault();
          const imageFiles: File[] = [];
          for (const entry of localFiles) {
            if (entry.isImage) {
              if (entry.file) imageFiles.push(entry.file);
              continue;
            }
            insertFileMentionAtCursor(
              fileItemFromAbsolutePath(entry.absolutePath, workdir),
            );
          }
          if (imageFiles.length > 0) {
            const fileList = new DataTransfer();
            imageFiles.forEach((f) => fileList.items.add(f));
            void handleImagePaste(fileList.files);
          }
          return;
        }
```

Then keep the existing pathless `image/*` + text branches.

Update `handlePaste` deps: add `insertFileMentionAtCursor`, `workdir`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd packages/webview && npx vitest run \
  tests/components/messageInput.localFiles.test.tsx \
  tests/components/messageInput.pasteImages.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/webview/src/components/chat/MessageInput.tsx \
  packages/webview/tests/components/messageInput.localFiles.test.tsx
git commit -m "$(cat <<'EOF'
feat(webview): paste local non-image files as @file mentions

EOF
)"
```

---

### Task 5: Smoke + hostBridge note (optional assert)

**Files:**
- Test (optional): `packages/webview/tests/muse/hostBridge.test.ts` — assert `desktopSelectFiles` is mirrored to `outer` (already true for all commands; document with one test)

- [ ] **Step 1: Add forwarding test (optional but recommended)**

```ts
  it("desktopSelectFiles is forwarded to outer (Electron file pick)", () => {
    const outer = {
      postMessage: vi.fn(),
      getState: () => null,
      setState: () => {},
    };
    const bridge = createHostBridge({
      api: stubApi(),
      ws: stubWs(),
      outer,
    });
    bridge.postMessage({ command: "desktopSelectFiles" });
    expect(outer.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectFiles",
    });
  });
```

- [ ] **Step 2: Run**

Run: `cd packages/webview && npx vitest run tests/muse/hostBridge.test.ts -t desktopSelectFiles`

Expected: PASS

- [ ] **Step 3: Full related suite**

Run:

```bash
cd packages/desktop && npx vitest run tests/workdirHost.test.ts -t desktopSelectFiles
cd packages/webview && npx vitest run \
  tests/muse/localFileMention.test.ts \
  tests/components/messageInput.localFiles.test.tsx \
  tests/components/messageInput.pasteImages.test.tsx
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add packages/webview/tests/muse/hostBridge.test.ts
git commit -m "$(cat <<'EOF'
test(webview): assert desktopSelectFiles forwarded to Electron

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Toolbar pick → `@file` multi | 2, 3 |
| Paste non-image → `@file` | 4 |
| Images → attachments | 4 (+ existing pasteImages) |
| workdir relative / outside absolute | 1, 3 |
| `@` dropdown unchanged | (no task — do not touch suggestions) |
| Desktop-only button | 3 (`enableLocalFilePick`) |
| Cancel silent | 2 |
| No directory pick | 2 (`openFile` only); paste skip trailing slash | 1, 4 |
| hostBridge 透传 | 5 (already global mirror) |

## Self-review notes

- No TBD placeholders in steps
- `insertFileMentionAtCursor` already exists; tasks only call it
- `FileItem.icon` set to `codicon-file` (sufficient for insert path; dropdown unused)
- Windows `file://` path normalization covered in `parseFileUriList`
