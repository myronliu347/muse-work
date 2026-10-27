/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QuickOpenPalette } from "../../src/components/panels/QuickOpenPalette";

describe("QuickOpenPalette", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("empty query shows empty list", () => {
    render(
      <QuickOpenPalette
        open
        workdir="/w"
        vscode={{ postMessage: vi.fn() }}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText("输入文件名或事项开始搜索")).toBeTruthy();
    expect(screen.queryByTestId(/^quick-open-item-/)).toBeNull();
  });

  it("Enter opens selected file and closes", () => {
    const postMessage = vi.fn();
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickOpenPalette
        open
        workdir="/w"
        vscode={{ postMessage }}
        onClose={onClose}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.change(screen.getByTestId("quick-open-input"), {
      target: { value: "a" },
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "requestFileSuggestions",
        source: "quickOpen",
        filterText: "a",
      }),
    );
    const requestId = postMessage.mock.calls[0][0].requestId as string;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "fileSuggestionsResponse",
            requestId,
            suggestions: [
              {
                path: "/w/a.ts",
                relativePath: "a.ts",
                name: "a.ts",
                isDirectory: false,
              },
            ],
          },
        }),
      );
    });
    fireEvent.keyDown(screen.getByTestId("quick-open").querySelector(".quick-open")!, {
      key: "Enter",
    });
    expect(onOpenFile).toHaveBeenCalledWith("/w/a.ts");
    expect(onClose).toHaveBeenCalled();
  });

  it("lists matching issues ahead of files and selects one", () => {
    const onSelectIssue = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickOpenPalette
        open
        workdir="/w"
        issues={[
          { id: "issue-1", title: "【BugFix】将原型快照补参迁入 dev", type: "bug" },
          { id: "issue-2", title: "圆角还没对齐", type: "work" },
        ]}
        vscode={{ postMessage: vi.fn() }}
        onClose={onClose}
        onOpenFile={vi.fn()}
        onSelectIssue={onSelectIssue}
      />,
    );
    fireEvent.change(screen.getByTestId("quick-open-input"), {
      target: { value: "快照" },
    });
    fireEvent.click(screen.getByTestId("quick-open-issue-issue-1"));
    expect(onSelectIssue).toHaveBeenCalledWith("issue-1");
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId("quick-open-issue-issue-2")).toBeNull();
  });

  it("prefills the query when opened with initialQuery", () => {
    const postMessage = vi.fn();
    render(
      <QuickOpenPalette
        open
        initialQuery="hello.ts"
        workdir="/w"
        vscode={{ postMessage }}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByTestId("quick-open-input")).toHaveValue("hello.ts");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "requestFileSuggestions",
        filterText: "hello.ts",
        source: "quickOpen",
      }),
    );
  });
});
