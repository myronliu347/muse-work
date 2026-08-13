/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileSuggestionDropdown } from "../../src/components/FileSuggestionDropdown";
import type { FileItem } from "../../src/types";

const srcDir: FileItem = {
  path: "/ws/src",
  relativePath: "src/",
  name: "src",
  extension: "",
  icon: "codicon-folder",
  isDirectory: true,
};

const hello: FileItem = {
  path: "/ws/src/hello.ts",
  relativePath: "src/hello.ts",
  name: "hello.ts",
  extension: "ts",
  icon: "codicon-file",
  isDirectory: false,
};

const position = { top: 0, left: 0 };

describe("FileSuggestionDropdown", () => {
  it("browse mode shows breadcrumb and enter chevron; click chevron does not select", () => {
    const onSelect = vi.fn();
    const onEnterDirectory = vi.fn();
    const onBrowseTo = vi.fn();

    render(
      <FileSuggestionDropdown
        suggestions={[srcDir]}
        isVisible
        selectedIndex={0}
        onSelect={onSelect}
        onClose={() => {}}
        position={position}
        filterText=""
        browsePath="lib"
        onEnterDirectory={onEnterDirectory}
        onBrowseTo={onBrowseTo}
      />,
    );

    expect(screen.getByTestId("suggestion-breadcrumb")).toHaveTextContent(
      "工作区",
    );
    expect(screen.getByTestId("suggestion-breadcrumb")).toHaveTextContent("lib");
    expect(screen.getByTestId("suggestion-enter-src")).toBeInTheDocument();
    expect(screen.queryByText("src/")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("suggestion-enter-src"));
    expect(onEnterDirectory).toHaveBeenCalledWith(srcDir);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "工作区" }));
    expect(onBrowseTo).toHaveBeenCalledWith("");
  });

  it("search mode shows name and path on one row without chevron", () => {
    render(
      <FileSuggestionDropdown
        suggestions={[hello]}
        isVisible
        selectedIndex={0}
        onSelect={() => {}}
        onClose={() => {}}
        position={position}
        filterText="hel"
        browsePath="lib"
      />,
    );

    expect(screen.queryByTestId("suggestion-breadcrumb")).not.toBeInTheDocument();
    expect(screen.getByText("hello.ts")).toBeInTheDocument();
    expect(screen.getByText("src/hello.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("suggestion-enter-hello.ts")).not.toBeInTheDocument();
  });

  it("shows empty-directory copy in browse mode", () => {
    render(
      <FileSuggestionDropdown
        suggestions={[]}
        isVisible
        selectedIndex={0}
        onSelect={() => {}}
        onClose={() => {}}
        position={position}
        filterText=""
        isLoading={false}
      />,
    );

    expect(screen.getByText("此目录为空")).toBeInTheDocument();
  });
});
