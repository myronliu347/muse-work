/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import React from "react";

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

/** Split drags paint on the next frame; the width commits on release. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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
      {/* Surface a snippet so accordion tests can assert expand/collapse. */}
      <span>
        {patch
          .split("\n")
          .find((l) => l.startsWith("+") && !l.startsWith("+++"))
          ?.slice(1) ?? ""}
      </span>
      {renderGutterUtility?.(() => ({
        side: "additions",
        lineNumber: 1,
      }))}
      {renderGutterUtility?.(() => ({
        side: "additions",
        lineNumber: 2,
      }))}
      {(lineAnnotations ?? []).map((ann) => (
        <div key={`${ann.side}-${ann.lineNumber}`}>
          {renderAnnotation?.(ann)}
        </div>
      ))}
    </div>
  ),
}));

import { DiffPane, formatDiffComment } from "../../src/components/panels/DiffPane";
import type { WorkspaceDiffFile } from "../../src/components/panels/DiffPane";
import { createMockVscode, sendCommand } from "./test-utils";

function makeFile(
  overrides: Partial<WorkspaceDiffFile> = {},
): WorkspaceDiffFile {
  return {
    path: "src/a.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    hunks: "@@ -1,1 +1,2 @@\n-old\n+new1\n+new2",
    truncated: false,
    binary: false,
    ...overrides,
  };
}

function renderPane(options?: {
  paneId?: string;
  width?: number;
  visible?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  workdir?: string;
  baseBranch?: string;
  onClose?: () => void;
  onAddComment?: (text: string) => void;
  onOpenFile?: (path: string) => void;
  onSendMessage?: (text: string) => void;
  /** Recent is the default; pass "unstaged" to start in the workspace-git mode. */
  initialMode?: "recent" | "unstaged";
  diffView?: { mode: "recent" | "unstaged"; file?: { path: string; additions?: number; deletions?: number; hunks?: string } };
  recentFiles?: Array<{
    path: string;
    status?: string;
    additions?: number;
    deletions?: number;
    hunks?: string;
    truncated?: boolean;
    binary?: boolean;
  }>;
}) {
  const vscode = createMockVscode();
  const onClose = options?.onClose ?? vi.fn();
  const initialMode = options?.initialMode ?? "recent";
  const result = render(
    <Theme>
    <DiffPane
      vscode={vscode}
      width={options?.width ?? 420}
      onWidthChange={vi.fn()}
      maxWidth={716}
      onClose={onClose}
      paneId={options?.paneId}
      visible={options?.visible ?? true}
      isStreaming={options?.isStreaming ?? false}
      sessionId={options?.sessionId}
      workdir={options?.workdir}
      baseBranch={options?.baseBranch}
      diffView={
        options?.diffView ?? {
          mode: initialMode,
          ...(initialMode === "recent" ? {} : { file: undefined }),
        }
      }
      recentFiles={options?.recentFiles as never}
      onAddComment={options?.onAddComment}
      onOpenFile={options?.onOpenFile}
      onSendMessage={options?.onSendMessage}
    />
    </Theme>,
  );
  const rerenderWith = (props: {
    width?: number;
    visible?: boolean;
    isStreaming?: boolean;
    sessionId?: string;
    workdir?: string;
    diffView?: { mode: "recent" | "unstaged"; file?: { path: string; additions?: number; deletions?: number; hunks?: string } };
    recentFiles?: Array<{
      path: string;
      status?: string;
      additions?: number;
      deletions?: number;
      hunks?: string;
      truncated?: boolean;
      binary?: boolean;
    }>;
  }) =>
    result.rerender(
      <Theme>
      <DiffPane
        vscode={vscode}
        width={props.width ?? options?.width ?? 420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={onClose}
        paneId={options?.paneId}
        visible={props.visible ?? true}
        isStreaming={props.isStreaming ?? false}
        sessionId={props.sessionId}
        workdir={props.workdir}
        baseBranch={options?.baseBranch}
        diffView={props.diffView ?? options?.diffView}
        recentFiles={(props.recentFiles ?? options?.recentFiles) as never}
        onAddComment={options?.onAddComment}
        onOpenFile={options?.onOpenFile}
        onSendMessage={options?.onSendMessage}
      />
      </Theme>,
    );
  return { ...result, rerenderWith, vscode, onClose };
}

/** Open the Radix mode menu and pick a label. */
async function pickMode(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("diff-mode-select"));
  await user.click(await screen.findByRole("option", { name: label }));
}

/** Switch the toolbar dropdown to workspace-vs-HEAD. */
function switchToUnstaged() {
  return pickMode("未提交");
}

function sendDiffResult(files: WorkspaceDiffFile[], paneId?: string) {
  sendCommand("desktopWorkspaceDiff", {
    result: { kind: "ok", files },
    ...(paneId !== undefined ? { paneId } : {}),
  });
}

const lastDiffRequest = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls.filter(
    ([msg]) => msg.command === "desktopGetWorkspaceDiff",
  );

describe("DiffPane", () => {
  it("does not loop when recentFiles is a fresh array on every render", () => {
    // Regression: a parent that re-maps messages hands DiffPane a NEW
    // recentFiles array on every render. The recent-mode sync effect must
    // compare content (paths), not reference — otherwise setState re-renders →
    // new array → setState… "Maximum update depth exceeded".
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const vscode = createMockVscode();
    const makeFiles = () => [makeFile()].map((f) => ({ ...f }));
    const { rerender } = render(
      <Theme>
      <DiffPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={vi.fn()}
        paneId={undefined}
        visible
        isStreaming={false}
        sessionId="s1"
        workdir="/w/a"
        diffView={{ mode: "recent" }}
        recentFiles={makeFiles()}
        onAddComment={vi.fn()}
        onOpenFile={vi.fn()}
        onSendMessage={vi.fn()}
      />
      </Theme>,
    );
    // Re-render with a fresh recentFiles reference but identical content,
    // repeatedly — the previous code setState'd on every one of these.
    for (let i = 0; i < 20; i++) {
      rerender(
        <Theme>
        <DiffPane
          vscode={vscode}
          width={420}
          onWidthChange={vi.fn()}
          maxWidth={716}
          onClose={vi.fn()}
          paneId={undefined}
          visible
          isStreaming={false}
          sessionId="s1"
          workdir="/w/a"
          diffView={{ mode: "recent" }}
          recentFiles={makeFiles()}
          onAddComment={vi.fn()}
          onOpenFile={vi.fn()}
          onSendMessage={vi.fn()}
        />
        </Theme>,
      );
    }
    expect(screen.getByTestId("diff-pane")).toBeInTheDocument();
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
      expect.anything(),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it("defaults to recent mode and only requests the workspace diff after switching to unstaged", async () => {
    const { vscode } = renderPane();
    // Recent is the default: no workspace git request on mount.
    expect(
      vscode.postMessage.mock.calls.some(
        ([msg]) => msg.command === "desktopGetWorkspaceDiff",
      ),
    ).toBe(false);
    expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("最近一次修改");

    await switchToUnstaged();
    expect(
      vscode.postMessage.mock.calls.some(
        ([msg]) => msg.command === "desktopGetWorkspaceDiff",
      ),
    ).toBe(true);
    expect(
      document.querySelector(".desktop-panel-placeholder"),
    ).toHaveTextContent("加载中…");
  });

  it("hides recent-mode files while streaming", () => {
    const { rerenderWith } = renderPane({
      recentFiles: [makeFile()],
    });
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    rerenderWith({ isStreaming: true });
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(
      document.querySelector(".desktop-panel-placeholder"),
    ).toHaveTextContent("响应中…");
    rerenderWith({ isStreaming: false });
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("shows paths relative to workdir when under it", () => {
    renderPane({
      initialMode: "unstaged",
      workdir: "/work",
      width: 320,
    });
    sendDiffResult([
      makeFile({ path: "/work/src/a.ts" }),
      makeFile({ path: "/elsewhere/b.ts" }),
    ]);
    const paths = screen
      .getAllByTestId("diff-file-path")
      .map((el) => el.textContent);
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("/elsewhere/b.ts");
  });

  it("renders file blocks with status, path and +/- stats", () => {
    renderPane({ initialMode: "unstaged", width: 320 });
    sendDiffResult([
      makeFile(),
      makeFile({
        path: "img/logo.png",
        status: "added",
        additions: 0,
        deletions: 0,
        binary: true,
        hunks: "",
      }),
    ]);
    expect(screen.getByTestId("diff-file-modified")).toBeInTheDocument();
    expect(screen.getByTestId("diff-file-added")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("diff-file-modified")
        .querySelector("img.diff-file-icon"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("diff-file-added").querySelector("img.diff-file-icon"),
    ).not.toBeNull();
    expect(
      screen
        .getByTestId("diff-file-modified")
        .querySelector(".codicon-diff-modified"),
    ).toBeNull();
    expect(screen.queryByText("修改")).not.toBeInTheDocument();
    expect(screen.queryByText("新增")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("renders a Pierre PatchDiff for file hunks", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([makeFile()]);
    const el = screen.getByTestId("pierre-patch-diff");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-patch")).toContain("--- a/src/a.ts");
    expect(el.getAttribute("data-patch")).toContain("+new1");
  });

  it("exposes a line-comment gutter control on the PatchDiff", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([
      makeFile({ hunks: "@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;" }),
    ]);
    expect(screen.getAllByTestId("diff-comment-add").length).toBeGreaterThan(0);
  });

  it("binary files show a placeholder instead of hunks", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([makeFile({ binary: true, hunks: "" })]);
    expect(screen.getByText("二进制文件，不显示差异")).toBeInTheDocument();
  });

  it("truncated files show a truncation note", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([makeFile({ truncated: true })]);
    expect(screen.getByText("差异过大，已截断…")).toBeInTheDocument();
  });

  it("renames without content changes show the source path", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([
      makeFile({ status: "renamed", oldPath: "src/old.ts", hunks: "" }),
    ]);
    expect(screen.getByText("重命名自 src/old.ts")).toBeInTheDocument();
  });

  it("shows the not-a-repo state", () => {
    renderPane({ initialMode: "unstaged" });
    sendCommand("desktopWorkspaceDiff", { result: { kind: "not-a-repo" } });
    expect(
      document.querySelector(".desktop-panel-placeholder"),
    ).toHaveTextContent("非 git 仓库");
  });

  it("shows the no-changes state for an empty file list", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([]);
    expect(
      document.querySelector(".desktop-panel-placeholder"),
    ).toHaveTextContent("无改动");
    expect(screen.queryByTestId("diff-tree-nav")).not.toBeInTheDocument();
  });

  it("collapses and expands a file block via its header", () => {
    const { container } = renderPane({ initialMode: "unstaged", width: 320 });
    sendDiffResult([makeFile()]);
    const header = container.querySelector(".diff-file-header") as HTMLElement;
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("new1")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("new1")).toBeInTheDocument();
  });

  it("clicking the path opens the file without toggling expand", () => {
    const onOpenFile = vi.fn();
    const { container } = renderPane({
      onOpenFile,
      workdir: "/Users/dev/projects/muse-work",
      width: 320,
    });
    sendDiffResult([makeFile()]);
    const header = container.querySelector(".diff-file-header") as HTMLElement;
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByTestId("diff-file-path"));
    expect(onOpenFile).toHaveBeenCalledWith(
      "/Users/dev/projects/muse-work/src/a.ts",
    );
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  describe("mutual-exclusion accordion", () => {
    it("expands only the first file by default", () => {
      const { container } = renderPane({ initialMode: "unstaged", width: 320 });
      sendDiffResult([
        makeFile(),
        makeFile({ path: "src/b.ts" }),
        makeFile({ path: "src/c.ts" }),
      ]);
      const headers = container.querySelectorAll(".diff-file-header");
      expect(headers).toHaveLength(3);
      expect(headers[0]).toHaveAttribute("aria-expanded", "true");
      expect(headers[1]).toHaveAttribute("aria-expanded", "false");
      expect(headers[2]).toHaveAttribute("aria-expanded", "false");
      // Only the first file's hunks are in the DOM, all headers remain.
      expect(screen.getByText("new1")).toBeInTheDocument();
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(1);
    });

    it("expanding another file collapses the previously expanded one", () => {
      const { container } = renderPane({ initialMode: "unstaged", width: 320 });
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      const headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[1]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(1);
    });

    it("clicking the expanded file collapses it", () => {
      const { container } = renderPane({ initialMode: "unstaged", width: 320 });
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      const headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[0]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "false");
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(0);
    });

    it("keeps the expanded file across a refresh", () => {
      const { container } = renderPane({ initialMode: "unstaged", width: 320 });
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      let headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[1]);
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      // Refresh arrives with the same paths but new hunks; the expanded
      // file must stay expanded (not reset to the first file).
      sendDiffResult([
        makeFile({ path: "src/a.ts", hunks: "@@ -1 +1 @@\n-old\n+updated-a" }),
        makeFile({ path: "src/b.ts", hunks: "@@ -1 +1 @@\n-old\n+updated-b" }),
      ]);
      headers = container.querySelectorAll(".diff-file-header");
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("updated-b")).toBeInTheDocument();
      expect(screen.queryByText("updated-a")).not.toBeInTheDocument();
    });
  });

  it("refresh button requests the diff again", () => {
    const { vscode } = renderPane({ initialMode: "unstaged" });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("diff-refresh"));
    expect(lastDiffRequest(vscode)).toHaveLength(2);
  });

  it("commit button sends git commit via onSendMessage without a confirm dialog", () => {
    const onSendMessage = vi.fn();
    renderPane({ initialMode: "unstaged", onSendMessage });
    sendDiffResult([makeFile()]);
    fireEvent.click(screen.getByTestId("diff-commit"));
    expect(onSendMessage).toHaveBeenCalledWith("git commit");
    expect(screen.queryByTestId("confirm-dialog-overlay")).not.toBeInTheDocument();
  });

  it("disables commit and revert-all together when unavailable", () => {
    renderPane({ initialMode: "unstaged" });
    expect(screen.getByTestId("diff-commit")).toBeDisabled();
    expect(screen.getByTestId("diff-revert-all")).toBeDisabled();

    sendCommand("desktopWorkspaceDiff", { result: { kind: "not-a-repo" } });
    expect(screen.getByTestId("diff-commit")).toBeDisabled();
    expect(screen.getByTestId("diff-revert-all")).toBeDisabled();

    sendDiffResult([]);
    expect(screen.getByTestId("diff-commit")).toBeDisabled();
    expect(screen.getByTestId("diff-revert-all")).toBeDisabled();

    sendDiffResult([makeFile()]);
    expect(screen.getByTestId("diff-commit")).toBeEnabled();
    expect(screen.getByTestId("diff-revert-all")).toBeEnabled();
  });

  it("shows disabled-reason tooltips for commit and revert-all", () => {
    renderPane({ initialMode: "unstaged" });
    sendCommand("desktopWorkspaceDiff", { result: { kind: "not-a-repo" } });

    const commitTip = screen
      .getByTestId("diff-commit")
      .closest(".tooltip-container") as HTMLElement;
    fireEvent.mouseEnter(commitTip);
    expect(document.querySelector(".tooltip-box.visible")).toHaveTextContent(
      "非 git 仓库",
    );
    fireEvent.mouseLeave(commitTip);

    const revertTip = screen
      .getByTestId("diff-revert-all")
      .closest(".tooltip-container") as HTMLElement;
    fireEvent.mouseEnter(revertTip);
    expect(document.querySelector(".tooltip-box.visible")).toHaveTextContent(
      "非 git 仓库",
    );
  });

  it("tags requests with paneId and ignores responses for other panes", () => {
    const { vscode } = renderPane({ initialMode: "unstaged", paneId: "pane-1" });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopGetWorkspaceDiff",
        paneId: "pane-1",
      }),
    );
    sendDiffResult([makeFile()], "pane-2");
    expect(
      document.querySelector(".desktop-panel-placeholder"),
    ).toHaveTextContent("加载中…");
    sendDiffResult([], "pane-1");
    expect(
      document.querySelector(".desktop-panel-placeholder"),
    ).toHaveTextContent("无改动");
  });

  it("re-showing a hidden panel triggers a fresh load", () => {
    const { vscode, rerenderWith } = renderPane({ initialMode: "unstaged", visible: false });
    expect(lastDiffRequest(vscode)).toHaveLength(0);
    rerenderWith({ visible: true });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
  });

  it("drops the held workspace diff when the panel is hidden", () => {
    // Regression: the panel stays mounted after being closed (display:none),
    // so the full workspace diff previously lingered in state forever.
    const { rerenderWith } = renderPane({ initialMode: "unstaged" });
    sendDiffResult([makeFile()]);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();

    rerenderWith({ visible: false });
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diff-file-modified")).not.toBeInTheDocument();
  });

  it("restores recent-mode files when re-shown after being hidden", () => {
    const { rerenderWith } = renderPane({ recentFiles: [makeFile()] });
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();

    rerenderWith({ visible: false });
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();

    rerenderWith({ visible: true });
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("refreshes when generation ends while visible", () => {
    const { vscode, rerenderWith } = renderPane({ initialMode: "unstaged", isStreaming: true });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
    rerenderWith({ isStreaming: false });
    expect(lastDiffRequest(vscode)).toHaveLength(2);
  });

  it("keeps current files visible while the generation-end refresh is in flight", () => {
    const { rerenderWith } = renderPane({ initialMode: "unstaged", isStreaming: true });
    sendDiffResult([makeFile()]);
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    rerenderWith({ isStreaming: false });
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    sendDiffResult([makeFile({ path: "src/b.ts" })]);
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("keeps current files visible on manual refresh and spins the refresh icon until the response arrives", () => {
    renderPane({ initialMode: "unstaged" });
    sendDiffResult([makeFile()]);
    fireEvent.click(screen.getByTestId("diff-refresh"));
    expect(screen.queryByText("加载中…")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("diff-refresh")
        .querySelector(".codicon-modifier-spin"),
    ).not.toBeNull();
    sendDiffResult([makeFile()]);
    expect(
      screen
        .getByTestId("diff-refresh")
        .querySelector(".codicon-modifier-spin"),
    ).toBeNull();
  });

  it("restores the session diff mode after switching away and back", () => {
    const { vscode, rerenderWith } = renderPane({
      initialMode: "unstaged",
      sessionId: "s1",
      workdir: "/w/a",
      recentFiles: [makeFile({ path: "recent.ts" })],
    });
    expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("未提交");
    rerenderWith({
      sessionId: "s2",
      workdir: "/w/b",
      recentFiles: [makeFile({ path: "other.ts" })],
    });
    // A session that has not picked a range yet still opens on 最近一次修改.
    expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("最近一次修改");
    expect(screen.getByTestId("diff-pane")).toHaveTextContent("other.ts");

    rerenderWith({
      sessionId: "s1",
      workdir: "/w/a",
      recentFiles: [makeFile({ path: "recent.ts" })],
    });
    expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("未提交");
    const requests = lastDiffRequest(vscode);
    expect(requests.at(-1)?.[0]).toEqual(
      expect.objectContaining({ workdir: "/w/a" }),
    );
  });

  it("does not refresh on generation end while hidden", () => {
    const { vscode, rerenderWith } = renderPane({
      initialMode: "unstaged",
      visible: false,
      isStreaming: true,
    });
    rerenderWith({ visible: false, isStreaming: false });
    expect(lastDiffRequest(vscode)).toHaveLength(0);
  });

  it("stays in unstaged mode and refreshes when the session context changes while visible", () => {
    const { vscode, rerenderWith } = renderPane({
      initialMode: "unstaged",
      sessionId: "s1",
      workdir: "/w/a",
    });
    expect(lastDiffRequest(vscode)).toHaveLength(1);
    // Simulate a fresh diffView target that keeps unstaged mode (e.g. a dock
    // toggle with the mode persisted) while the session changes.
    rerenderWith({ sessionId: "s2", workdir: "/w/b" });
    expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("最近一次修改");
    rerenderWith({
      sessionId: "s2",
      workdir: "/w/b",
      diffView: { mode: "unstaged" },
    });
    expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("未提交");
    expect(lastDiffRequest(vscode).length).toBeGreaterThan(1);
  });

  it("drag handle resizes within min/max bounds", async () => {
    const onWidthChange = vi.fn();
    const vscode = createMockVscode();
    render(
      <Theme>
      <DiffPane
        vscode={vscode}
        width={420}
        onWidthChange={onWidthChange}
        maxWidth={716}
        onClose={vi.fn()}
        visible={true}
        isStreaming={false}
      />
      </Theme>,
    );
    const pane = screen.getByTestId("diff-pane");
    const handle = pane.querySelector(
      ".preview-pane-drag-handle",
    ) as HTMLElement;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      right: 1024,
    } as DOMRect);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
    // The handle stays lit for the whole drag instead of relying on :hover,
    // which flickers when the pointer outruns the 6px handle.
    expect(handle.style.background).not.toBe("");
    expect(document.body.classList.contains("is-panel-resizing")).toBe(true);
    fireEvent.pointerMove(window, { clientX: 624 }); // 1024 - 624 = 400
    await nextFrame();
    expect(pane).toHaveStyle({ width: "400px" });
    expect(onWidthChange).not.toHaveBeenCalled();
    expect(handle.style.background).not.toBe(""); // still lit mid-drag
    fireEvent.pointerMove(window, { clientX: 950 }); // 74 → clamped to 320
    await nextFrame();
    expect(pane).toHaveStyle({ width: "320px" });
    fireEvent.pointerMove(window, { clientX: 10 }); // 1014 → clamped to 716
    await nextFrame();
    expect(pane).toHaveStyle({ width: "716px" });
    fireEvent.pointerUp(window);
    expect(onWidthChange).toHaveBeenLastCalledWith(716);
    expect(handle.style.background).toBe(""); // cleared on release
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);
  });

  describe("line comments", () => {
    it("formats a diff-line comment with path, prefix and text", () => {
      expect(
        formatDiffComment({
          path: "a.ts",
          prefix: "+",
          text: "x",
          comment: "改这里",
        }),
      ).toBe("**差异评论** · a.ts\n`+`「x」\n\n改这里");
      // context-line prefix (space) is omitted
      expect(
        formatDiffComment({
          path: "a.ts",
          prefix: " ",
          text: "x",
          comment: "c",
        }),
      ).toBe("**差异评论** · a.ts\n「x」\n\nc");
    });

    it("shows a comment gutter control on the PatchDiff", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      expect(screen.getAllByTestId("diff-comment-add").length).toBeGreaterThan(
        0,
      );
    });

    it("opens a comment box under the clicked line with the file path", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      const box = screen.getByTestId("diff-comment-box");
      expect(box).toBeInTheDocument();
      expect(screen.getByTestId("diff-comment-input")).toBeInTheDocument();
      expect(box.querySelector(".diff-comment-box-tag")).toHaveTextContent(
        "src/a.ts",
      );
    });

    it("appends the comment to the input and closes the box on submit", () => {
      const onAddComment = vi.fn();
      renderPane({ initialMode: "unstaged", onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      fireEvent.change(screen.getByTestId("diff-comment-input"), {
        target: { value: "改这里" },
      });
      fireEvent.click(screen.getByTestId("diff-comment-submit"));
      expect(onAddComment).toHaveBeenCalledWith(
        "**差异评论** · src/a.ts\n`+`「new1」\n\n改这里",
      );
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("submits on Enter (without shift)", () => {
      const onAddComment = vi.fn();
      renderPane({ initialMode: "unstaged", onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      const input = screen.getByTestId("diff-comment-input");
      fireEvent.change(input, { target: { value: "好" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onAddComment).toHaveBeenCalled();
    });

    it("does not submit on Enter while IME is composing (e.g. pinyin)", () => {
      const onAddComment = vi.fn();
      renderPane({ initialMode: "unstaged", onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      const input = screen.getByTestId("diff-comment-input");
      fireEvent.change(input, { target: { value: "改这里" } });
      // Chinese IME uses Enter to confirm the candidate; that keydown fires
      // with isComposing=true (keyCode 229) and must NOT submit the draft.
      fireEvent.keyDown(input, {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
      });
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it("does not submit when the comment is empty", () => {
      const onAddComment = vi.fn();
      renderPane({ initialMode: "unstaged", onAddComment });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      fireEvent.click(screen.getByTestId("diff-comment-submit"));
      expect(onAddComment).not.toHaveBeenCalled();
    });

    it("closes the box on Escape", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      fireEvent.keyDown(screen.getByTestId("diff-comment-input"), {
        key: "Escape",
      });
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("closes the box via the cancel button", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      fireEvent.click(screen.getByTestId("diff-comment-cancel"));
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("discards the open comment box on refresh", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      expect(screen.getByTestId("diff-comment-box")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("diff-refresh"));
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("keeps at most one comment box open (clicking another line moves it)", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      const buttons = screen.getAllByTestId("diff-comment-add");
      fireEvent.click(buttons[0]);
      expect(screen.getByTestId("diff-comment-box")).toBeInTheDocument();
      fireEvent.click(buttons[1]);
      expect(screen.queryAllByTestId("diff-comment-box")).toHaveLength(1);
    });
  });

  describe("revert", () => {
    it("disables revert-all when there are no files", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([]);
      expect(screen.getByTestId("diff-revert-all")).toBeDisabled();
      expect(screen.getByTestId("diff-commit")).toBeDisabled();
    });

    it("opens confirm for revert-all and posts paths on confirm", () => {
      const { vscode } = renderPane({ initialMode: "unstaged", paneId: "p1", workdir: "/repo" });
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
      const { vscode } = renderPane({ initialMode: "unstaged" });
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
      const { vscode, container } = renderPane({ initialMode: "unstaged", paneId: "p1", width: 320 });
      sendDiffResult([makeFile()], "p1");
      const header = container.querySelector(".diff-file-header") as HTMLElement;
      expect(header).toHaveAttribute("aria-expanded", "true");
      vscode.postMessage.mockClear();
      fireEvent.click(screen.getByTestId("diff-revert-file"));
      expect(header).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(/丢弃「src\/a\.ts」的改动？/)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopRevertWorkspaceDiff",
        paneId: "p1",
        paths: ["src/a.ts"],
      });
    });

    it("successful revert triggers a soft refresh", () => {
      const { vscode } = renderPane({ initialMode: "unstaged", paneId: "p1" });
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
      renderPane({ initialMode: "unstaged", paneId: "p1" });
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

  describe("mode selector (最近一次修改 / 未提交文件)", () => {
    it("does not loop when recentFiles changes at generation end (streaming false)", () => {
      // Regression: turn end pushes file_history:update → recentFiles gets a
      // new array; combined with isStreaming false, DiffPane must settle
      // without a setState-in-effect feedback loop (maximum update depth).
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { rerenderWith } = renderPane({
        visible: true,
        isStreaming: true,
        recentFiles: [],
      });
      // Generation ends: isStreaming drops and the file_history delta arrives,
      // both new arrays/references in the same render batch.
      rerenderWith({
        isStreaming: false,
        recentFiles: [makeFile()],
      });
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Maximum update depth exceeded"),
        expect.anything(),
        expect.anything(),
      );
      errorSpy.mockRestore();
    });

    it("defaults to recent mode and hides commit/discard actions", () => {
      renderPane();
      const select = screen.getByTestId("diff-mode-select");
      expect(select).toHaveTextContent("最近一次修改");
      expect(select).toHaveTextContent("最近一次修改");
      // Recent mode hides the workspace-git commit/discard actions.
      expect(screen.queryByTestId("diff-commit")).not.toBeInTheDocument();
      expect(screen.queryByTestId("diff-revert-all")).not.toBeInTheDocument();
    });

    it("renders recentFiles without a workspace git request", () => {
      const { vscode } = renderPane({
        recentFiles: [
          makeFile({
            path: "src/a.ts",
            hunks: "@@ -1,1 +1,2 @@\n-old\n+new1",
          }),
        ],
      });
      expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("最近一次修改");
      expect(screen.getByTestId("diff-pane")).toHaveTextContent("src/a.ts");
      // PatchDiff mock strips the "+" prefix and surfaces the added line.
      expect(screen.getByTestId("diff-pane")).toHaveTextContent("new1");
      // No workspace git request was issued for recent mode.
      expect(
        vscode.postMessage.mock.calls.some(
          ([msg]) => msg.command === "desktopGetWorkspaceDiff",
        ),
      ).toBe(false);
    });

    it("switching to unstaged re-requests the workspace diff", async () => {
      const { vscode } = renderPane();
      vscode.postMessage.mockClear();
      await switchToUnstaged();
      expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("未提交");
      expect(
        vscode.postMessage.mock.calls.some(
          ([msg]) => msg.command === "desktopGetWorkspaceDiff",
        ),
      ).toBe(true);
    });
  });

  describe("commit patch (某次提交的改动)", () => {
    const commits = [
      {
        hash: "abc111",
        shortHash: "abc111",
        subject: "second",
        author: "Ada",
        date: "2026-10-15T01:02:03Z",
      },
    ];

    it("lists commits and shows that commit's own patch", async () => {
      const { vscode } = renderPane({ paneId: "p1", workdir: "/repo" });
      vscode.postMessage.mockClear();
      await pickMode("某次提交的改动");
      expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("某次提交的改动");
      expect(screen.queryByTestId("diff-commit")).not.toBeInTheDocument();
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "desktopListCommits",
        paneId: "p1",
        workdir: "/repo",
      });
      sendCommand("desktopCommits", {
        paneId: "p1",
        result: { kind: "ok", commits },
      });
      expect(screen.getByTestId("diff-commit-select")).toHaveTextContent("abc111");
      const diffReq = vscode.postMessage.mock.calls
        .map(([msg]) => msg)
        .filter((msg) => msg.command === "desktopGetCommitDiff")
        .at(-1);
      expect(diffReq).toEqual(
        expect.objectContaining({
          command: "desktopGetCommitDiff",
          paneId: "p1",
          workdir: "/repo",
          rev: "abc111",
        }),
      );
      sendCommand("desktopWorkspaceDiff", {
        paneId: "p1",
        requestId: diffReq.requestId,
        result: { kind: "ok", files: [makeFile()] },
      });
      expect(screen.getByTestId("diff-pane")).toHaveTextContent("src/a.ts");
      expect(screen.queryByTestId("diff-revert-file")).not.toBeInTheDocument();
    });
  });

  describe("branch diff (当前分支所有改动)", () => {
    function switchToBranch() {
      return pickMode("当前分支所有改动");
    }

    function lastBranchRequest(vscode: ReturnType<typeof createMockVscode>) {
      return vscode.postMessage.mock.calls
        .map(([msg]) => msg)
        .filter((msg) => msg.command === "desktopGetBranchDiff")
        .at(-1);
    }

    it("sends the session base branch with the branch diff request", async () => {
      const { vscode } = renderPane({
        paneId: "p1",
        workdir: "/repo",
        baseBranch: "develop",
      });
      vscode.postMessage.mockClear();
      await switchToBranch();
      expect(lastBranchRequest(vscode)).toEqual(
        expect.objectContaining({
          command: "desktopGetBranchDiff",
          baseBranch: "develop",
          workdir: "/repo",
        }),
      );
    });

    it("shows the compared branch and requests a different one when edited", async () => {
      const { vscode } = renderPane({
        paneId: "p1",
        workdir: "/repo",
        baseBranch: "main",
      });
      vscode.postMessage.mockClear();
      await switchToBranch();
      const first = lastBranchRequest(vscode);
      sendCommand("desktopWorkspaceDiff", {
        paneId: "p1",
        requestId: first.requestId,
        result: { kind: "ok", files: [makeFile()], baseRef: "main" },
      });
      expect(screen.getByTestId("diff-base-select")).toHaveTextContent("main");
      sendCommand("desktopGitBranches", {
        paneId: "p1",
        workdir: "/repo",
        result: {
          branches: ["main", "develop"],
          remotes: ["origin/main"],
          current: "feature",
        },
      });
      const user = userEvent.setup();
      await user.click(screen.getByTestId("diff-base-select"));
      await user.click(await screen.findByTestId("diff-base-option-develop"));
      expect(lastBranchRequest(vscode)).toEqual(
        expect.objectContaining({
          command: "desktopGetBranchDiff",
          baseBranch: "develop",
          workdir: "/repo",
        }),
      );
    });

    it("requests the branch diff and hides commit and discard actions", async () => {
      const { vscode } = renderPane({ paneId: "p1", workdir: "/repo" });
      vscode.postMessage.mockClear();
      await switchToBranch();
      expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("当前分支所有改动");
      const user = userEvent.setup();
      await user.click(screen.getByTestId("diff-mode-select"));
      expect(await screen.findByRole("option", { name: "未提交" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "某次提交的改动" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "对比 HEAD" })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "自该提交至今" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByTestId("diff-commit")).not.toBeInTheDocument();
      expect(screen.queryByTestId("diff-revert-all")).not.toBeInTheDocument();

      const diffReq = lastBranchRequest(vscode);
      expect(diffReq).toEqual(
        expect.objectContaining({
          command: "desktopGetBranchDiff",
          paneId: "p1",
          workdir: "/repo",
        }),
      );
      expect(typeof diffReq.requestId).toBe("string");
      sendCommand("desktopWorkspaceDiff", {
        paneId: "p1",
        requestId: diffReq.requestId,
        result: { kind: "ok", files: [makeFile()] },
      });
      expect(screen.getByTestId("diff-pane")).toHaveTextContent("src/a.ts");
      expect(screen.queryByTestId("diff-revert-file")).not.toBeInTheDocument();
    });

    it("ignores a stale branch diff reply", async () => {
      const { vscode } = renderPane({ paneId: "p1" });
      await switchToBranch();
      const first = lastBranchRequest(vscode);
      fireEvent.click(screen.getByTestId("diff-refresh"));
      const second = lastBranchRequest(vscode);
      expect(second.requestId).not.toBe(first.requestId);

      sendCommand("desktopWorkspaceDiff", {
        paneId: "p1",
        requestId: first.requestId,
        result: { kind: "ok", files: [makeFile({ path: "stale.ts" })] },
      });
      expect(screen.queryByText("stale.ts")).not.toBeInTheDocument();
      sendCommand("desktopWorkspaceDiff", {
        paneId: "p1",
        requestId: second.requestId,
        result: { kind: "ok", files: [makeFile({ path: "branch.ts" })] },
      });
      expect(screen.getByTestId("diff-pane")).toHaveTextContent("branch.ts");
    });

    it("restores the branch view when switching back to the session", async () => {
      const { vscode, rerenderWith } = renderPane({
        paneId: "p1",
        sessionId: "s1",
        workdir: "/repo",
        recentFiles: [makeFile({ path: "recent.ts" })],
      });
      await switchToBranch();
      rerenderWith({
        sessionId: "s2",
        workdir: "/other",
        recentFiles: [makeFile({ path: "other.ts" })],
      });
      expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("最近一次修改");
      expect(screen.getByTestId("diff-pane")).toHaveTextContent("other.ts");

      rerenderWith({
        sessionId: "s1",
        workdir: "/repo",
        recentFiles: [makeFile({ path: "recent.ts" })],
      });
      expect(screen.getByTestId("diff-mode-select")).toHaveTextContent("当前分支所有改动");
      expect(lastBranchRequest(vscode)).toEqual(
        expect.objectContaining({
          command: "desktopGetBranchDiff",
          workdir: "/repo",
        }),
      );
    });
  });

  describe("tree view (列表/树视图切换)", () => {
    it("opens the change tree by default and collapses it when the pane is narrow", async () => {
      const { rerenderWith } = renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      const toggle = screen.getByTestId("diff-view-toggle");
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle).toHaveAttribute("title", "列表视图");
      expect(screen.getByTestId("diff-tree-nav")).toBeInTheDocument();

      rerenderWith({ width: 320 });
      expect(screen.getByTestId("diff-view-toggle")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByTestId("diff-view-toggle")).toHaveAttribute(
        "title",
        "宽度不足，已收起文件树",
      );
      expect(screen.getByTestId("diff-tree-nav")).toHaveClass("is-closing");
      await waitFor(() => {
        expect(screen.queryByTestId("diff-tree-nav")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("diff-file-modified")).toBeInTheDocument();

      rerenderWith({ width: 420 });
      expect(screen.getByTestId("diff-tree-nav")).toBeInTheDocument();

      sendDiffResult([]);
      expect(screen.getByTestId("diff-tree-nav")).toHaveClass("is-closing");
      await waitFor(() => {
        expect(screen.queryByTestId("diff-tree-nav")).not.toBeInTheDocument();
      });
      expect(
        document.querySelector(".desktop-panel-placeholder"),
      ).toHaveTextContent("无改动");
    });

    it("keeps the change tree mounted while it closes", async () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      expect(screen.getByTestId("diff-tree-nav")).not.toHaveClass("is-closing");
      fireEvent.click(screen.getByTestId("diff-view-toggle"));
      expect(screen.getByTestId("diff-tree-nav")).toHaveClass("is-closing");
      await waitFor(() => {
        expect(screen.queryByTestId("diff-tree-nav")).not.toBeInTheDocument();
      });
    });

    it("switching to tree view shows the right-side tree and the first file diff on the left", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([
        makeFile({ path: "src/a.ts" }),
        makeFile({ path: "lib/c.ts" }),
      ]);
      expect(screen.getByTestId("diff-view-toggle")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Right side: change tree with directory nodes.
      expect(screen.getByTestId("diff-tree-nav")).toBeInTheDocument();
      expect(screen.getByTestId("diff-tree-header")).toHaveTextContent(
        "2 个文件变更",
      );
      expect(screen.getByTestId("diff-tree-dir-src")).toBeInTheDocument();
      expect(screen.getByTestId("diff-tree-dir-lib")).toBeInTheDocument();
      // Left side: the first file's diff block is shown by default.
      expect(screen.getByTestId("diff-file-modified")).toBeInTheDocument();
      expect(screen.getByTestId("pierre-patch-diff")).toBeInTheDocument();
      expect(screen.getByText("new1")).toBeInTheDocument();
      // Both files appear as leaf nodes in the tree.
      expect(screen.getAllByTestId("diff-tree-file-modified")).toHaveLength(2);
    });

    it("resizes the change-tree column by dragging the left edge", async () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile()]);
      const nav = screen.getByTestId("diff-tree-nav");
      expect(nav).toHaveClass("is-opening");
      expect(nav).toHaveStyle({ width: "240px" });
      const handle = screen.getByTestId("diff-tree-resize");
      fireEvent.pointerDown(handle, {
        button: 0,
        pointerId: 1,
        clientX: 500,
      });
      expect(nav).not.toHaveClass("is-opening");
      fireEvent.pointerMove(window, { clientX: 460 });
      await nextFrame();
      expect(nav).toHaveStyle({ width: "280px" });
      fireEvent.pointerUp(window);
      // Dragging left 40px widens a right-side column to 280.
      expect(nav).toHaveStyle({ width: "280px" });
    });

    it("collapses and expands a directory node in the tree", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([
        makeFile({ path: "src/a.ts" }),
        makeFile({ path: "lib/c.ts" }),
      ]);
      expect(screen.getAllByTestId("diff-tree-file-modified")).toHaveLength(2);
      const srcDir = screen.getByTestId("diff-tree-dir-src");
      expect(srcDir).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(srcDir);
      expect(srcDir).toHaveAttribute("aria-expanded", "false");
      // The src/a.ts leaf is hidden; lib/c.ts remains.
      const leaves = screen.getAllByTestId("diff-tree-file-modified");
      expect(leaves).toHaveLength(1);
      expect(leaves[0]).toHaveAttribute("data-path", "lib/c.ts");
      fireEvent.click(srcDir);
      expect(screen.getAllByTestId("diff-tree-file-modified")).toHaveLength(2);
    });

    it("clicking a tree file switches the left diff content", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([
        makeFile({
          path: "src/a.ts",
          hunks: "@@ -1,1 +1,2 @@\n-old\n+first-file",
        }),
        makeFile({
          path: "lib/c.ts",
          hunks: "@@ -1,1 +1,2 @@\n-old\n+second-file",
        }),
      ]);
      // Default selection is the first file (src/a.ts).
      expect(screen.getByText("first-file")).toBeInTheDocument();
      const cNode = screen
        .getAllByTestId("diff-tree-file-modified")
        .find((el) => el.getAttribute("data-path") === "lib/c.ts") as HTMLElement;
      fireEvent.click(cNode);
      expect(cNode).toHaveClass("diff-tree-file--active");
      expect(screen.getByText("second-file")).toBeInTheDocument();
      expect(screen.queryByText("first-file")).not.toBeInTheDocument();
    });

    it("keeps line comments and open-file working in tree view", () => {
      const onOpenFile = vi.fn();
      const onAddComment = vi.fn();
      renderPane({
        initialMode: "unstaged",
        workdir: "/repo",
        onOpenFile,
        onAddComment,
      });
      sendDiffResult([makeFile()]);
      // Open-file: clicking the path in the left detail resolves against workdir.
      fireEvent.click(screen.getByTestId("diff-file-path"));
      expect(onOpenFile).toHaveBeenCalledWith("/repo/src/a.ts");
      // Line comment: gutter control still opens the comment box and submits.
      fireEvent.click(screen.getAllByTestId("diff-comment-add")[0]);
      expect(screen.getByTestId("diff-comment-box")).toBeInTheDocument();
      fireEvent.change(screen.getByTestId("diff-comment-input"), {
        target: { value: "改这里" },
      });
      fireEvent.click(screen.getByTestId("diff-comment-submit"));
      expect(onAddComment).toHaveBeenCalledWith(
        "**差异评论** · src/a.ts\n`+`「new1」\n\n改这里",
      );
      expect(screen.queryByTestId("diff-comment-box")).not.toBeInTheDocument();
    });

    it("builds the tree relative to workdir for absolute paths under it", () => {
      renderPane({ initialMode: "unstaged", workdir: "/Users/lyy/repo" });
      sendDiffResult([
        makeFile({
          path: "/Users/lyy/repo/frontend/README.md",
          hunks: "@@ -1 +1 @@\n-old\n+new-readme",
        }),
      ]);
      // The tree starts at the workdir root, not the filesystem root.
      expect(screen.getByTestId("diff-tree-dir-frontend")).toBeInTheDocument();
      expect(
        screen.queryByTestId("diff-tree-dir-Users"),
      ).not.toBeInTheDocument();
      // The file node keeps its original absolute path for open/revert.
      expect(screen.getByTestId("diff-tree-file-modified")).toHaveAttribute(
        "data-path",
        "/Users/lyy/repo/frontend/README.md",
      );
    });

    it("merges multi-level single-child directory chains into one node", () => {
      renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile({ path: "a/b/c/file.ts" })]);
      // The whole a/b/c chain collapses into a single directory row.
      const dirNode = screen.getByTestId("diff-tree-dir-a/b/c");
      expect(dirNode).toHaveTextContent("a/b/c");
      expect(screen.getByTestId("diff-tree-file-modified")).toBeInTheDocument();
      // Collapsing the merged node hides the file underneath.
      fireEvent.click(dirNode);
      expect(dirNode).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByTestId("diff-tree-file-modified"),
      ).not.toBeInTheDocument();
    });
  });

  it("switches the assistant diff between issues and shows name plus workdir", async () => {
    const user = userEvent.setup();
    const onSelectIssue = vi.fn();
    render(
      <Theme>
        <DiffPane
          vscode={createMockVscode()}
          width={420}
          onWidthChange={vi.fn()}
          maxWidth={716}
          onClose={vi.fn()}
          visible
          isStreaming={false}
          issueId="issue-a"
          homeDir="/Users/lyy"
          onSelectIssue={onSelectIssue}
          issues={[
            {
              id: "issue-a",
              title: "修登录",
              workdir: "/Users/lyy/repo/frontend",
            },
            {
              id: "issue-b",
              title: "补测试",
              workdir: "/Users/lyy/repo/backend",
            },
          ]}
        />
      </Theme>,
    );

    const trigger = screen.getByTestId("diff-issue-select");
    expect(trigger).toHaveTextContent("修登录");
    expect(trigger).not.toHaveTextContent("/Users/lyy/repo/frontend");
    expect(screen.getByTestId("diff-mode-select")).toBeInTheDocument();

    await user.click(trigger);
    const option = await screen.findByTestId("diff-issue-option-issue-b");
    expect(option).toHaveTextContent("补测试");
    expect(option).toHaveTextContent("~/repo/backend");
    expect(option).not.toHaveTextContent("/Users/lyy/repo/backend");
    await user.click(option);
    expect(onSelectIssue).toHaveBeenCalledWith("issue-b");
  });
});
