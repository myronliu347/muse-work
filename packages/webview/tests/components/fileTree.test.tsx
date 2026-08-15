/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "../../src/components/panels/FileTree";
import {
  emptyFileTreeState,
  emptyContentSearchState,
  type FileTreeState,
} from "../../src/stores/panelGroupStore";

beforeEach(() => {
  // @tanstack/react-virtual needs a non-zero scrollport in jsdom
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 240,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 240,
    height: 400,
    top: 0,
    left: 0,
    bottom: 400,
    right: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

function openTree(overrides: Partial<FileTreeState> = {}): FileTreeState {
  return { ...emptyFileTreeState(), collapsed: false, ...overrides };
}

describe("FileTree", () => {
  const postMessage = vi.fn();
  const onTreeChange = vi.fn();
  const onOpenFile = vi.fn();

  beforeEach(() => {
    postMessage.mockClear();
    onTreeChange.mockClear();
    onOpenFile.mockClear();
  });

  it("defaults to a collapsed rail", () => {
    render(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={emptyFileTreeState()}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );
    expect(screen.getByTestId("file-tree")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    expect(screen.getByTestId("file-tree-expand-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree-workdir")).toBeNull();
  });

  it("expands and collapses the tree column", () => {
    const { rerender } = render(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={emptyFileTreeState()}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(screen.getByTestId("file-tree-expand-btn"));
    expect(onTreeChange).toHaveBeenCalledWith(
      expect.objectContaining({ collapsed: false }),
    );

    rerender(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={openTree()}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(screen.getByTestId("file-tree-collapse-btn"));
    expect(onTreeChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ collapsed: true }),
    );
  });

  it("requests root listing when cache is empty", () => {
    render(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={openTree()}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopListDir",
        dir: "",
        workdir: "/work",
      }),
    );
    expect(screen.getByTestId("file-tree-workdir").textContent).toContain(
      "work",
    );
  });

  it("opens a file on click", () => {
    const tree = openTree({
      childrenCache: {
        "": [
          {
            name: "a.ts",
            path: "/work/a.ts",
            relativePath: "a.ts",
            isDirectory: false,
          },
        ],
      },
    });

    render(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={tree}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByTestId("file-tree-row-a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("/work/a.ts");
  });

  it("toggles directory expansion", () => {
    const tree = openTree({
      childrenCache: {
        "": [
          {
            name: "src",
            path: "/work/src",
            relativePath: "src",
            isDirectory: true,
          },
        ],
      },
    });

    render(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={tree}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );

    fireEvent.click(screen.getByTestId("file-tree-row-src"));
    expect(onTreeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        expanded: expect.arrayContaining(["src"]),
      }),
    );
  });

  it("switches between tree and search modes", () => {
    const onMode = vi.fn();
    render(
      <FileTree
        workdir="/w"
        vscode={{ postMessage }}
        tree={openTree()}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
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
});
