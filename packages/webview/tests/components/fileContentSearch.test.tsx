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
});
