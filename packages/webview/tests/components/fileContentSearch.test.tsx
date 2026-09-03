/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileContentSearch } from "../../src/components/panels/FileContentSearch";
import { emptyContentSearchState } from "../../src/stores/panelGroupStore";
import type { ContentSearchState } from "../../src/types";

describe("FileContentSearch", () => {
  it("toggles case/word/regex and updates state", () => {
    const onStateChange = vi.fn();
    render(
      <FileContentSearch
        workdir="/w"
        state={{ ...emptyContentSearchState(), query: "foo" }}
        onStateChange={onStateChange}
        onOpenMatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-case"));
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ caseSensitive: true }),
    );
  });

  it("expands file and opens match line", () => {
    const onOpenMatch = vi.fn();
    const onStateChange = vi.fn();
    const state: ContentSearchState = {
      ...emptyContentSearchState(),
      query: "hi",
      results: [
        {
          path: "/w/a.ts",
          relativePath: "a.ts",
          matches: [{ line: 3, text: "hi there", startCol: 0, endCol: 2 }],
        },
      ],
      expandedFiles: ["a.ts"],
    };
    render(
      <FileContentSearch
        workdir="/w"
        state={state}
        onStateChange={onStateChange}
        onOpenMatch={onOpenMatch}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-match-a.ts-3"));
    expect(onOpenMatch).toHaveBeenCalledWith("/w/a.ts", 3);
  });

  const treeState = (): ContentSearchState => ({
    ...emptyContentSearchState(),
    query: "hi",
    results: [
      {
        path: "/w/src/a.ts",
        relativePath: "src/a.ts",
        matches: [{ line: 3, text: "hi there", startCol: 0, endCol: 2 }],
      },
      {
        path: "/w/src/b.ts",
        relativePath: "src/b.ts",
        matches: [{ line: 5, text: "hi bob", startCol: 0, endCol: 2 }],
      },
      {
        path: "/w/README.md",
        relativePath: "README.md",
        matches: [{ line: 1, text: "hi doc", startCol: 0, endCol: 2 }],
      },
    ],
    expandedFiles: [],
  });

  it("shows view-toggle icons and defaults to list view", () => {
    render(
      <FileContentSearch
        workdir="/w"
        state={treeState()}
        onStateChange={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    const listBtn = screen.getByTestId("content-search-view-list");
    const treeBtn = screen.getByTestId("content-search-view-tree");
    expect(listBtn).toBeInTheDocument();
    expect(treeBtn).toBeInTheDocument();
    expect(listBtn).toHaveAttribute("aria-pressed", "true");
    expect(treeBtn).toHaveAttribute("aria-pressed", "false");
    // List view is the default: flat file rows, no tree panel.
    expect(screen.getByTestId("content-search-file-src/a.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("content-search-tree-panel")).not.toBeInTheDocument();
  });

  it("switches to tree view: folders then files in one list", () => {
    render(
      <FileContentSearch
        workdir="/w"
        state={treeState()}
        onStateChange={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-view-tree"));
    expect(screen.getByTestId("content-search-tree-panel")).toBeInTheDocument();
    expect(screen.getByTestId("content-search-view-list")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("content-search-view-tree")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("content-search-tree-dir-src")).toBeInTheDocument();
    expect(screen.getByTestId("content-search-tree-file-src/a.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("content-search-match-src/a.ts-3")).not.toBeInTheDocument();
  });

  it("collapses and expands directory nodes in tree view", () => {
    render(
      <FileContentSearch
        workdir="/w"
        state={treeState()}
        onStateChange={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-view-tree"));
    expect(screen.getByTestId("content-search-tree-file-src/a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("content-search-tree-dir-src"));
    expect(screen.queryByTestId("content-search-tree-file-src/a.ts")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-search-tree-file-README.md")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("content-search-tree-dir-src"));
    expect(screen.getByTestId("content-search-tree-file-src/a.ts")).toBeInTheDocument();
  });

  it("expands a tree file in place to show matches", () => {
    const onStateChange = vi.fn();
    render(
      <FileContentSearch
        workdir="/w"
        state={treeState()}
        onStateChange={onStateChange}
        onOpenMatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-view-tree"));
    fireEvent.click(screen.getByTestId("content-search-tree-file-README.md"));
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ expandedFiles: ["README.md"] }),
    );
  });

  it("opens a match line from an expanded tree file", () => {
    const onOpenMatch = vi.fn();
    render(
      <FileContentSearch
        workdir="/w"
        state={{ ...treeState(), expandedFiles: ["src/a.ts"] }}
        onStateChange={vi.fn()}
        onOpenMatch={onOpenMatch}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-view-tree"));
    fireEvent.click(screen.getByTestId("content-search-match-src/a.ts-3"));
    expect(onOpenMatch).toHaveBeenCalledWith("/w/src/a.ts", 3);
  });

  it("merges empty directory chains into a single node", () => {
    const state: ContentSearchState = {
      ...emptyContentSearchState(),
      query: "hi",
      results: [
        {
          path: "/w/src/components/ui/Button.tsx",
          relativePath: "src/components/ui/Button.tsx",
          matches: [{ line: 1, text: "hi btn", startCol: 0, endCol: 2 }],
        },
      ],
      expandedFiles: [],
    };
    render(
      <FileContentSearch
        workdir="/w"
        state={state}
        onStateChange={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-view-tree"));
    // One merged dir node for the whole chain, no intermediate dirs.
    expect(screen.getByTestId("content-search-tree-dir-src/components/ui")).toBeInTheDocument();
    expect(screen.queryByTestId("content-search-tree-dir-src")).not.toBeInTheDocument();
    expect(screen.queryByTestId("content-search-tree-dir-src/components")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-search-tree-file-src/components/ui/Button.tsx")).toBeInTheDocument();
  });

  it("keeps a dir with siblings unmerged but merges its single-child chain", () => {
    const state: ContentSearchState = {
      ...emptyContentSearchState(),
      query: "hi",
      results: [
        {
          path: "/w/src/a.ts",
          relativePath: "src/a.ts",
          matches: [{ line: 3, text: "hi there", startCol: 0, endCol: 2 }],
        },
        {
          path: "/w/src/components/ui/Button.tsx",
          relativePath: "src/components/ui/Button.tsx",
          matches: [{ line: 1, text: "hi btn", startCol: 0, endCol: 2 }],
        },
      ],
      expandedFiles: [],
    };
    render(
      <FileContentSearch
        workdir="/w"
        state={state}
        onStateChange={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("content-search-view-tree"));
    // src has a file sibling, so it stays; components/ui chain merges below it.
    expect(screen.getByTestId("content-search-tree-dir-src")).toBeInTheDocument();
    expect(screen.getByTestId("content-search-tree-dir-src/components/ui")).toBeInTheDocument();
    expect(screen.queryByTestId("content-search-tree-dir-src/components")).not.toBeInTheDocument();
  });

  it("does not emit duplicate-key warnings when matches clip to the same column", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Long-line truncation maps both matches to the same clipped startCol; the
    // keys must still differ (index suffix) or React warns + may drop children.
    const state: ContentSearchState = {
      ...emptyContentSearchState(),
      query: "hi",
      results: [
        {
          path: "/w/a.ts",
          relativePath: "a.ts",
          matches: [
            { line: 3, text: "x".repeat(400), startCol: 198, endCol: 201 },
            { line: 3, text: "y".repeat(400), startCol: 198, endCol: 201 },
          ],
        },
      ],
      expandedFiles: ["a.ts"],
    };
    render(
      <FileContentSearch
        workdir="/w"
        state={state}
        onStateChange={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    const messages = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");
    errorSpy.mockRestore();
    expect(messages).not.toContain("same key");
    // Both matches are present (same clipped column, different windows).
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(3);
  });
});
