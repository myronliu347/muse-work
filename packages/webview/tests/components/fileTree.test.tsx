/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "../../src/components/panels/FileTree";
import {
  emptyFileTreeState,
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

describe("FileTree", () => {
  const postMessage = vi.fn();
  const onTreeChange = vi.fn();
  const onOpenFile = vi.fn();

  beforeEach(() => {
    postMessage.mockClear();
    onTreeChange.mockClear();
    onOpenFile.mockClear();
  });

  it("requests root listing when cache is empty", () => {
    render(
      <FileTree
        workdir="/work"
        vscode={{ postMessage }}
        tree={emptyFileTreeState()}
        onTreeChange={onTreeChange}
        onOpenFile={onOpenFile}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopListDir", dir: "" }),
    );
  });

  it("opens a file on click", () => {
    const tree: FileTreeState = {
      ...emptyFileTreeState(),
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
    };

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
    const tree: FileTreeState = {
      ...emptyFileTreeState(),
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
    };

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
});
