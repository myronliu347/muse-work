/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";

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
  visible?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  workdir?: string;
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
    <DiffPane
      vscode={vscode}
      width={420}
      onWidthChange={vi.fn()}
      maxWidth={716}
      onClose={onClose}
      paneId={options?.paneId}
      visible={options?.visible ?? true}
      isStreaming={options?.isStreaming ?? false}
      sessionId={options?.sessionId}
      workdir={options?.workdir}
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
    />,
  );
  const rerenderWith = (props: {
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
      <DiffPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={onClose}
        paneId={options?.paneId}
        visible={props.visible ?? true}
        isStreaming={props.isStreaming ?? false}
        sessionId={props.sessionId}
        workdir={props.workdir}
        diffView={props.diffView ?? options?.diffView}
        recentFiles={(props.recentFiles ?? options?.recentFiles) as never}
        onAddComment={options?.onAddComment}
        onOpenFile={options?.onOpenFile}
        onSendMessage={options?.onSendMessage}
      />,
    );
  return { ...result, rerenderWith, vscode, onClose };
}

/** Switch the toolbar dropdown to the unstaged (workspace git) mode. */
function switchToUnstaged() {
  fireEvent.change(screen.getByTestId("diff-mode-select"), {
    target: { value: "unstaged" },
  });
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
      />,
    );
    // Re-render with a fresh recentFiles reference but identical content,
    // repeatedly — the previous code setState'd on every one of these.
    for (let i = 0; i < 20; i++) {
      rerender(
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
        />,
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

  it("defaults to recent mode and only requests the workspace diff after switching to unstaged", () => {
    const { vscode } = renderPane();
    // Recent is the default: no workspace git request on mount.
    expect(
      vscode.postMessage.mock.calls.some(
        ([msg]) => msg.command === "desktopGetWorkspaceDiff",
      ),
    ).toBe(false);
    expect(screen.getByTestId("diff-mode-select")).toHaveValue("recent");

    switchToUnstaged();
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
    renderPane({ initialMode: "unstaged" });
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
        .querySelector(".codicon-diff-modified"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("diff-file-added").querySelector(".codicon-diff-added"),
    ).not.toBeNull();
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
  });

  it("collapses and expands a file block via its header", () => {
    const { container } = renderPane({ initialMode: "unstaged" });
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
      workdir: "/Users/dev/projects/wave-agent",
    });
    sendDiffResult([makeFile()]);
    const header = container.querySelector(".diff-file-header") as HTMLElement;
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByTestId("diff-file-path"));
    expect(onOpenFile).toHaveBeenCalledWith(
      "/Users/dev/projects/wave-agent/src/a.ts",
    );
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  describe("mutual-exclusion accordion", () => {
    it("expands only the first file by default", () => {
      const { container } = renderPane({ initialMode: "unstaged" });
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
      const { container } = renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      const headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[1]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "true");
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(1);
    });

    it("clicking the expanded file collapses it", () => {
      const { container } = renderPane({ initialMode: "unstaged" });
      sendDiffResult([makeFile(), makeFile({ path: "src/b.ts" })]);
      const headers = container.querySelectorAll(".diff-file-header");
      fireEvent.click(headers[0]);
      expect(headers[0]).toHaveAttribute("aria-expanded", "false");
      expect(headers[1]).toHaveAttribute("aria-expanded", "false");
      expect(container.querySelectorAll(".diff-file-body")).toHaveLength(0);
    });

    it("keeps the expanded file across a refresh", () => {
      const { container } = renderPane({ initialMode: "unstaged" });
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
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopGetWorkspaceDiff",
      paneId: "pane-1",
    });
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

  it("resets to recent mode when the session context changes", () => {
    const { rerenderWith } = renderPane({
      initialMode: "unstaged",
      sessionId: "s1",
      workdir: "/w/a",
      recentFiles: [makeFile()],
    });
    expect(screen.getByTestId("diff-mode-select")).toHaveValue("unstaged");
    rerenderWith({ sessionId: "s2", workdir: "/w/b" });
    // Switching sessions defaults back to 最近一次修改, showing the new
    // session's reloaded file_history data instead of the old git diff.
    expect(screen.getByTestId("diff-mode-select")).toHaveValue("recent");
    expect(screen.getByTestId("diff-pane")).toHaveTextContent("src/a.ts");
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
    expect(screen.getByTestId("diff-mode-select")).toHaveValue("recent");
    rerenderWith({
      sessionId: "s2",
      workdir: "/w/b",
      diffView: { mode: "unstaged" },
    });
    expect(screen.getByTestId("diff-mode-select")).toHaveValue("unstaged");
    expect(lastDiffRequest(vscode).length).toBeGreaterThan(1);
  });

  it("drag handle resizes within min/max bounds", () => {
    const onWidthChange = vi.fn();
    const vscode = createMockVscode();
    render(
      <DiffPane
        vscode={vscode}
        width={420}
        onWidthChange={onWidthChange}
        maxWidth={716}
        onClose={vi.fn()}
        visible={true}
        isStreaming={false}
      />,
    );
    const pane = screen.getByTestId("diff-pane");
    const handle = pane.querySelector(
      ".preview-pane-drag-handle",
    ) as HTMLElement;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      right: 1024,
    } as DOMRect);

    fireEvent.mouseDown(handle);
    // The handle stays lit for the whole drag instead of relying on :hover,
    // which flickers when the pointer outruns the 6px handle.
    expect(handle.style.background).not.toBe("");
    expect(document.body.classList.contains("is-panel-resizing")).toBe(true);
    fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    expect(handle.style.background).not.toBe(""); // still lit mid-drag
    fireEvent.mouseMove(window, { clientX: 950 }); // 74 → clamped to 320
    expect(onWidthChange).toHaveBeenLastCalledWith(320);
    fireEvent.mouseMove(window, { clientX: 10 }); // 1014 → clamped to 716
    expect(onWidthChange).toHaveBeenLastCalledWith(716);
    fireEvent.mouseUp(window);
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
      const { vscode, container } = renderPane({ initialMode: "unstaged", paneId: "p1" });
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
      expect(select).toHaveValue("recent");
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
      expect(screen.getByTestId("diff-mode-select")).toHaveValue("recent");
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

    it("switching to unstaged re-requests the workspace diff", () => {
      const { vscode } = renderPane();
      vscode.postMessage.mockClear();
      switchToUnstaged();
      expect(screen.getByTestId("diff-mode-select")).toHaveValue("unstaged");
      expect(
        vscode.postMessage.mock.calls.some(
          ([msg]) => msg.command === "desktopGetWorkspaceDiff",
        ),
      ).toBe(true);
    });
  });
});
