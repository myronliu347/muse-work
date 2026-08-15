/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import React from "react";
import { FilePane } from "../../src/components/panels/FilePane";
import type { FileTreeState, FileViewState } from "../../src/types";
import { emptyFileTreeState } from "../../src/stores/panelGroupStore";

vi.mock("../../src/utils/shikiHighlighter", () => ({
  highlightCode: async (code: string) =>
    code.replace(/\n$/, "").split("\n").map((line) =>
      line.includes("const")
        ? line.replace("const", '<span class="shiki-kw">const</span>')
        : line,
    ),
  getShikiTheme: (dark: boolean) => (dark ? "github-dark" : "github-light"),
  langFromPath: () => "typescript",
}));

function makeFileView(overrides: Partial<FileViewState> = {}): FileViewState {
  return {
    path: "/work/a/src/app.ts",
    host: "local",
    content: "const a = 1;\nconst b = 2;\n",
    ...overrides,
  };
}

function renderPane(
  options: {
    fileView?: FileViewState | null;
    width?: number;
    maxWidth?: number;
    workdir?: string;
    fileTree?: FileTreeState;
    onRevealInFinder?: (path: string) => void;
    onOpenFile?: (path: string) => void;
    onFileTreeChange?: (next: FileTreeState) => void;
    onClose?: () => void;
    onWidthChange?: (width: number) => void;
  } = {},
) {
  const onClose = options.onClose ?? vi.fn();
  const onWidthChange = options.onWidthChange ?? vi.fn();
  const onOpenFile = options.onOpenFile ?? vi.fn();
  const onFileTreeChange = options.onFileTreeChange ?? vi.fn();
  const vscode = { postMessage: vi.fn() };
  const fileView =
    options.fileView === undefined ? makeFileView() : options.fileView;
  const result = render(
    <FilePane
      fileView={fileView}
      width={options.width ?? 420}
      onWidthChange={onWidthChange}
      maxWidth={options.maxWidth ?? 716}
      onClose={onClose}
      workdir={options.workdir ?? "/work/a"}
      vscode={vscode}
      fileTree={options.fileTree ?? emptyFileTreeState()}
      onFileTreeChange={onFileTreeChange}
      onOpenFile={onOpenFile}
      onRevealInFinder={options.onRevealInFinder}
    />,
  );
  return {
    ...result,
    onClose,
    onWidthChange,
    onOpenFile,
    onFileTreeChange,
    vscode,
  };
}

describe("FilePane", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it("shows the placeholder when no file is open", () => {
    renderPane({ fileView: null });
    expect(
      screen.getByText("从消息或右侧文件树打开文件"),
    ).toBeInTheDocument();
  });

  it("shows path bar with relative path", () => {
    renderPane({ workdir: "/work/a" });
    expect(screen.getByTestId("file-path-bar")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByTitle("/work/a/src/app.ts")).toBeInTheDocument();
  });

  it("shows absolute path when outside workdir", () => {
    renderPane({ workdir: "/other" });
    expect(screen.getByText("/work/a/src/app.ts")).toBeInTheDocument();
  });

  it("shows the error state instead of content", () => {
    renderPane({
      fileView: {
        path: "/work/a/nope.ts",
        host: "local",
        error: "文件不存在：/work/a/nope.ts",
      },
    });
    expect(screen.getByText("文件不存在：/work/a/nope.ts")).toBeInTheDocument();
  });

  it("shows unsupported with Finder button", () => {
    const onRevealInFinder = vi.fn();
    renderPane({
      fileView: {
        path: "/work/a/big.bin",
        host: "local",
        unsupported: "too-large",
        sizeBytes: 2_000_000,
      },
      onRevealInFinder,
    });
    expect(screen.getByTestId("file-unsupported")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("file-reveal-finder"));
    expect(onRevealInFinder).toHaveBeenCalledWith("/work/a/big.bin");
  });

  it("renders markdown preview by default with toggle", async () => {
    const { container } = renderPane({
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "# 标题\n\n正文 **加粗**",
      },
    });
    const md = container.querySelector(".file-pane-markdown");
    expect(md).not.toBeNull();
    expect(md?.querySelector("h1")?.textContent).toBe("标题");
    expect(screen.getByTestId("file-md-toggle")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Source"));
    await waitFor(() => {
      expect(container.querySelector(".file-pane-code")).not.toBeNull();
    });
  });

  it("renders code files as numbered lines", async () => {
    const { container } = renderPane();
    await waitFor(() => {
      expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
    });
  });

  it("marks the requested line range as active", async () => {
    const { container } = renderPane({
      fileView: makeFileView({ startLine: 1, endLine: 1 }),
    });
    await waitFor(() => {
      const lines = container.querySelectorAll(".file-pane-line");
      expect(lines[0].classList.contains("file-pane-line--active")).toBe(true);
    });
  });

  it("renders an inlined base64 image", () => {
    renderPane({
      fileView: {
        path: "/work/a/img/pic.png",
        host: "local",
        imageBase64: "data:image/png;base64,AAAA",
      },
    });
    const img = screen.getByAltText("img/pic.png");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("drag handle resizes within min/max bounds", () => {
    const { onWidthChange } = renderPane({ maxWidth: 716 });
    const pane = screen.getByTestId("file-pane");
    const handle = pane.querySelector(
      ".preview-pane-drag-handle",
    ) as HTMLElement;
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 1024,
    } as DOMRect);

    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(window, { clientX: 624 });
    expect(onWidthChange).toHaveBeenLastCalledWith(400);
    fireEvent.mouseMove(window, { clientX: 950 });
    expect(onWidthChange).toHaveBeenLastCalledWith(320);
    fireEvent.mouseMove(window, { clientX: 10 });
    expect(onWidthChange).toHaveBeenLastCalledWith(716);
    fireEvent.mouseUp(window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
