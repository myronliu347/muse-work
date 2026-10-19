/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import React from "react";
import { FilePane } from "../../src/components/panels/FilePane";
import { FilePreview } from "../../src/components/panels/FilePreview";
import type { FileTreeState, FileViewState } from "../../src/types";
import { emptyFileTreeState } from "../../src/stores/panelGroupStore";
import {
  FILE_SELECTION_CLIPBOARD_MIME,
  parseFileSelectionClipboard,
} from "../../src/utils/filePanelDnD";

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
    onRefreshOpenFile?: (path: string) => void;
    onOpenInPreview?: (path: string) => void;
    onFileTreeChange?: (next: FileTreeState) => void;
    onClose?: () => void;
    onWidthChange?: (width: number) => void;
    isStreaming?: boolean;
    visible?: boolean;
  } = {},
) {
  const onClose = options.onClose ?? vi.fn();
  const onWidthChange = options.onWidthChange ?? vi.fn();
  const onOpenFile = options.onOpenFile ?? vi.fn();
  const onRefreshOpenFile = options.onRefreshOpenFile ?? vi.fn();
  const onOpenInPreview = options.onOpenInPreview ?? vi.fn();
  const onFileTreeChange = options.onFileTreeChange ?? vi.fn();
  const vscode = { postMessage: vi.fn() };
  const fileView =
    options.fileView === undefined ? makeFileView() : options.fileView;
  const props: React.ComponentProps<typeof FilePane> = {
    fileView,
    width: options.width ?? 420,
    onWidthChange,
    maxWidth: options.maxWidth ?? 716,
    onClose,
    workdir: options.workdir ?? "/work/a",
    vscode,
    fileTree: options.fileTree ?? emptyFileTreeState(),
    onFileTreeChange,
    onOpenFile,
    onRefreshOpenFile,
    onOpenInPreview,
    onRevealInFinder: options.onRevealInFinder,
    isStreaming: options.isStreaming,
    visible: options.visible,
  };
  const result = render(<FilePane {...props} />);
  const rerenderWith = (next: Partial<typeof options>) => {
    result.rerender(<FilePane {...props} {...next} />);
  };
  return {
    ...result,
    onClose,
    onWidthChange,
    onOpenFile,
    onRefreshOpenFile,
    onOpenInPreview,
    onFileTreeChange,
    vscode,
    rerenderWith,
  };
}

function makeTab(path: string, overrides: Partial<FileViewState> = {}): FileViewState {
  return { path, host: "local", content: "const x = 1;\n", ...overrides };
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
    expect(screen.getByText("从消息或文件树打开文件")).toBeInTheDocument();
  });

  it("shows expand control in toolbar when tree is collapsed", () => {
    const { onFileTreeChange } = renderPane({
      fileView: null,
      fileTree: emptyFileTreeState(),
    });
    expect(screen.queryByTestId("file-tree")).toBeNull();
    fireEvent.click(screen.getByTestId("file-tree-expand-btn"));
    expect(onFileTreeChange).toHaveBeenCalledWith(
      expect.objectContaining({ collapsed: false }),
    );
  });

  it("opens the file tree when the open file is inside the workdir", () => {
    const { onFileTreeChange } = renderPane({
      fileView: makeFileView({ path: "/work/a/src/app.ts" }),
      workdir: "/work/a",
      fileTree: emptyFileTreeState(),
    });
    expect(onFileTreeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        collapsed: false,
        selected: "/work/a/src/app.ts",
        expanded: ["src"],
      }),
    );
  });

  it("leaves the file tree collapsed when the open file is outside the workdir", () => {
    const { onFileTreeChange } = renderPane({
      fileView: makeFileView({ path: "/other/notes.md" }),
      workdir: "/work/a",
      fileTree: emptyFileTreeState(),
    });
    expect(onFileTreeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        collapsed: true,
        selected: "/other/notes.md",
      }),
    );
  });

  it("hides expand control when tree is open", () => {
    renderPane({
      fileView: null,
      fileTree: { ...emptyFileTreeState(), collapsed: false },
    });
    expect(screen.queryByTestId("file-tree-expand-btn")).toBeNull();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
  });

  describe("refresh from preview toolbar when tree is collapsed", () => {
    it("shows a refresh button in the toolbar when tree is collapsed", () => {
      renderPane({ fileTree: emptyFileTreeState() });
      expect(screen.getByTestId("file-refresh-btn")).toBeInTheDocument();
    });

    it("hides the refresh button when tree is open", () => {
      renderPane({
        fileView: null,
        fileTree: { ...emptyFileTreeState(), collapsed: false },
      });
      expect(screen.queryByTestId("file-refresh-btn")).toBeNull();
    });

    it("re-opens the current file and refreshes listings", () => {
      const { onOpenFile, onRefreshOpenFile, onFileTreeChange, vscode } =
        renderPane({
          fileTree: {
            ...emptyFileTreeState(),
            expanded: ["src"],
            childrenCache: { "": [] },
          },
        });

      fireEvent.click(screen.getByTestId("file-refresh-btn"));

      expect(onRefreshOpenFile).toHaveBeenCalledWith("/work/a/src/app.ts");
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onFileTreeChange).toHaveBeenCalledWith(
        expect.objectContaining({ childrenCache: {} }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopListDir", dir: "" }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopListDir", dir: "src" }),
      );
    });

    it("still refreshes listings when no file is open", () => {
      const { onOpenFile, onRefreshOpenFile, onFileTreeChange, vscode } =
        renderPane({
          fileView: null,
          fileTree: { ...emptyFileTreeState(), expanded: ["src"] },
        });

      fireEvent.click(screen.getByTestId("file-refresh-btn"));

      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onRefreshOpenFile).not.toHaveBeenCalled();
      expect(onFileTreeChange).toHaveBeenCalledWith(
        expect.objectContaining({ childrenCache: {} }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopListDir", dir: "src" }),
      );
    });
  });

  describe("auto-refresh when an AI turn ends", () => {
    it("soft-refreshes the open file without activating via onOpenFile", () => {
      const {
        onOpenFile,
        onRefreshOpenFile,
        onFileTreeChange,
        vscode,
        rerenderWith,
      } = renderPane({
        isStreaming: true,
        fileTree: {
          ...emptyFileTreeState(),
          expanded: ["src"],
          childrenCache: { "": [] },
        },
      });

      rerenderWith({ isStreaming: false });

      expect(onRefreshOpenFile).toHaveBeenCalledWith("/work/a/src/app.ts");
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onFileTreeChange).toHaveBeenCalledWith(
        expect.objectContaining({ childrenCache: {} }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopListDir", dir: "" }),
      );
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "desktopListDir", dir: "src" }),
      );
    });

    it("does not refresh when streaming starts", () => {
      const {
        onOpenFile,
        onRefreshOpenFile,
        onFileTreeChange,
        vscode,
        rerenderWith,
      } = renderPane({
        fileTree: {
          ...emptyFileTreeState(),
          expanded: ["src"],
          childrenCache: { "": [], src: [] },
        },
      });
      rerenderWith({ isStreaming: true });
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onRefreshOpenFile).not.toHaveBeenCalled();
      expect(vscode.postMessage).not.toHaveBeenCalled();
      expect(onFileTreeChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ childrenCache: {} }),
      );
    });

    it("does not refresh when the panel is hidden", () => {
      const { onOpenFile, onRefreshOpenFile, vscode, rerenderWith } =
        renderPane({
          isStreaming: true,
          visible: false,
        });
      rerenderWith({ isStreaming: false, visible: false });
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onRefreshOpenFile).not.toHaveBeenCalled();
      expect(vscode.postMessage).not.toHaveBeenCalled();
    });

    it("does not refresh on initial mount while not streaming", () => {
      const { onOpenFile, onRefreshOpenFile, onFileTreeChange, vscode } =
        renderPane({
          fileTree: {
            ...emptyFileTreeState(),
            expanded: ["src"],
            childrenCache: { "": [], src: [] },
          },
        });
      expect(onOpenFile).not.toHaveBeenCalled();
      expect(onRefreshOpenFile).not.toHaveBeenCalled();
      expect(vscode.postMessage).not.toHaveBeenCalled();
      // Mount expands the tree for the open file; that is not a refresh.
      expect(onFileTreeChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ childrenCache: {} }),
      );
    });
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
    expect(screen.queryByText("正在读取文件…")).toBeNull();
  });

  it("renders empty files instead of staying on the loading stub", () => {
    renderPane({
      fileView: {
        path: "/work/a/empty.ts",
        host: "local",
        content: "",
      },
    });
    expect(screen.queryByText("正在读取文件…")).toBeNull();
    expect(screen.getByTestId("file-path-bar")).toBeInTheDocument();
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

  it("opens the built-in preview for local html files", () => {
    const { onOpenInPreview, vscode } = renderPane({
      fileView: {
        path: "/work/a/index.html",
        host: "local",
        content: "<h1>Hello</h1>",
      },
    });
    fireEvent.click(screen.getByTestId("file-open-in-browser"));
    expect(onOpenInPreview).toHaveBeenCalledWith("/work/a/index.html");
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it("hides open-in-browser button for non-html files", () => {
    renderPane();
    expect(screen.queryByTestId("file-open-in-browser")).toBeNull();
  });

  it("hides open-in-browser button for remote html files", () => {
    renderPane({
      fileView: {
        path: "/remote/index.html",
        host: "ssh-host",
        content: "<h1>Hello</h1>",
      },
    });
    expect(screen.queryByTestId("file-open-in-browser")).toBeNull();
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
    fireEvent.click(screen.getByText("源码"));
    await waitFor(() => {
      expect(container.querySelector(".file-pane-code")).not.toBeNull();
    });
  });

  it("opens workdir-relative markdown links in the panel", () => {
    const { onOpenFile } = renderPane({
      workdir: "/work/a",
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "[docs](../docs/x.md#intro) 和 [plan](plans/plan.md)",
      },
    });
    fireEvent.click(screen.getByText("docs"));
    expect(onOpenFile).toHaveBeenCalledWith("/work/docs/x.md");
    fireEvent.click(screen.getByText("plan"));
    expect(onOpenFile).toHaveBeenCalledWith("/work/a/plans/plan.md");
  });

  it("decodes percent-encoded CJK markdown hrefs", () => {
    const { onOpenFile } = renderPane({
      workdir: "/work/a",
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "[指引](认证指引.md)",
      },
    });
    fireEvent.click(screen.getByText("指引"));
    expect(onOpenFile).toHaveBeenCalledWith("/work/a/认证指引.md");
  });

  it("routes external markdown links to the system browser", () => {
    const { vscode } = renderPane({
      workdir: "/work/a",
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "[site](https://example.com/a)",
      },
    });
    fireEvent.click(screen.getByText("site"));
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "https://example.com/a",
    });
  });

  it("leaves # anchors to their default in-page jump", () => {
    const { onOpenFile, vscode } = renderPane({
      workdir: "/work/a",
      fileView: {
        path: "/work/a/README.md",
        host: "local",
        content: "[top](#intro)",
      },
    });
    fireEvent.click(screen.getByText("top"));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(vscode.postMessage).not.toHaveBeenCalled();
  });

  it("renders code files as numbered lines", async () => {
    const { container } = renderPane();
    await waitFor(() => {
      expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
    });
  });

  describe("file search", () => {
    async function openSearch() {
      renderPane();
      await waitFor(() => {
        expect(document.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      fireEvent.click(screen.getByTestId("file-search-btn"));
      expect(screen.getByTestId("file-search-bar")).toBeInTheDocument();
      return screen.getByTestId("file-search-input") as HTMLInputElement;
    }

    it("opens the search bar from the toolbar button", async () => {
      renderPane();
      await waitFor(() => {
        expect(document.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      expect(screen.queryByTestId("file-search-bar")).toBeNull();
      fireEvent.click(screen.getByTestId("file-search-btn"));
      expect(screen.getByTestId("file-search-bar")).toBeInTheDocument();
    });

    it("opens the search bar with Cmd+F", async () => {
      renderPane();
      await waitFor(() => {
        expect(document.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      expect(screen.getByTestId("file-search-bar")).toBeInTheDocument();
    });

    it("highlights matches and shows the match counter", async () => {
      const { container } = renderPane();
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      fireEvent.click(screen.getByTestId("file-search-btn"));
      fireEvent.change(screen.getByTestId("file-search-input"), {
        target: { value: "const" },
      });
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-search-mark").length).toBe(2);
      });
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("1/2");
    });

    it("navigates next and previous, wrapping around", async () => {
      const input = await openSearch();
      fireEvent.change(input, { target: { value: "const" } });
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("1/2");
      fireEvent.click(screen.getByTestId("file-search-next"));
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("2/2");
      fireEvent.click(screen.getByTestId("file-search-next"));
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("1/2");
      fireEvent.click(screen.getByTestId("file-search-prev"));
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("2/2");
    });

    it("Enter goes to the next match, Shift+Enter to previous", async () => {
      const input = await openSearch();
      fireEvent.change(input, { target: { value: "const" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("2/2");
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("1/2");
    });

    it("highlights the current match distinctly", async () => {
      const { container } = renderPane();
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      fireEvent.click(screen.getByTestId("file-search-btn"));
      fireEvent.change(screen.getByTestId("file-search-input"), {
        target: { value: "const" },
      });
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-search-mark").length).toBe(2);
      });
      let current = container.querySelectorAll(".file-pane-search-mark--current");
      expect(current.length).toBe(1);
      expect(current[0].textContent).toBe("const");
      fireEvent.click(screen.getByTestId("file-search-next"));
      await waitFor(() => {
        const next = container.querySelectorAll(".file-pane-search-mark--current");
        expect(next.length).toBe(1);
        const lineNo = next[0].closest(".file-pane-line")?.querySelector(
          ".file-pane-line-no",
        );
        expect(lineNo?.textContent).toBe("2");
      });
    });

    it("Esc closes the search bar", async () => {
      const input = await openSearch();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByTestId("file-search-bar")).toBeNull();
    });

    it("closing the search bar clears the highlights", async () => {
      const { container } = renderPane();
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      fireEvent.click(screen.getByTestId("file-search-btn"));
      fireEvent.change(screen.getByTestId("file-search-input"), {
        target: { value: "const" },
      });
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-search-mark").length).toBe(2);
      });
      fireEvent.click(screen.getByTestId("file-search-close"));
      expect(screen.queryByTestId("file-search-bar")).toBeNull();
      expect(container.querySelectorAll(".file-pane-search-mark").length).toBe(0);
    });

    it("clears highlights when the query is emptied", async () => {
      const { container } = renderPane();
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      fireEvent.click(screen.getByTestId("file-search-btn"));
      const input = screen.getByTestId("file-search-input");
      fireEvent.change(input, { target: { value: "const" } });
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-search-mark").length).toBe(2);
      });
      fireEvent.change(input, { target: { value: "" } });
      expect(container.querySelectorAll(".file-pane-search-mark").length).toBe(0);
      expect(screen.getByTestId("file-search-count")).toHaveTextContent("0/0");
    });

    it("hides the search button in markdown preview mode", () => {
      renderPane({
        fileView: {
          path: "/work/a/README.md",
          host: "local",
          content: "# 标题",
        },
      });
      expect(screen.queryByTestId("file-search-btn")).toBeNull();
    });
  });

  describe("per-tab markdown mode", () => {
    const mdTab = (path: string): FileViewState => ({
      path,
      host: "local",
      content: "# 标题",
    });

    it("remembers each tab's preview/source mode across switches", () => {
      const { rerenderWith } = renderPane({
        fileView: mdTab("/work/a/A.md"),
      });
      // Switch A to source mode.
      fireEvent.click(screen.getByText("源码"));
      expect(screen.getByTestId("file-md-toggle")).toBeInTheDocument();
      const sourceBtn = () =>
        screen
          .getByTestId("file-md-toggle")
          .querySelectorAll("button")[1] as HTMLButtonElement;
      expect(sourceBtn().getAttribute("aria-pressed")).toBe("true");

      // B still defaults to preview.
      rerenderWith({
        fileView: mdTab("/work/a/B.md"),
      });
      expect(sourceBtn().getAttribute("aria-pressed")).toBe("false");

      // Back to A: source mode restored.
      rerenderWith({
        fileView: mdTab("/work/a/A.md"),
      });
      expect(sourceBtn().getAttribute("aria-pressed")).toBe("true");
    });

    it("closes the search bar when switching files", async () => {
      const { rerenderWith } = renderPane({
        fileView: makeTab("/work/a/a.ts"),
      });
      await waitFor(() => {
        expect(document.querySelectorAll(".file-pane-line").length).toBe(1);
      });
      fireEvent.click(screen.getByTestId("file-search-btn"));
      expect(screen.getByTestId("file-search-bar")).toBeInTheDocument();
      rerenderWith({
        fileView: makeTab("/work/a/b.ts"),
      });
      expect(screen.queryByTestId("file-search-bar")).toBeNull();
    });
  });

  describe("FilePreview scroll memory", () => {
    it("restores a saved scroll offset once content renders", async () => {
      render(
        <FilePreview
          fileView={makeFileView()}
          workdir="/work/a"
          savedScrollTop={120}
        />,
      );
      await waitFor(() => {
        expect(document.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      const body = document.querySelector(
        ".file-pane-preview-body",
      ) as HTMLElement;
      Object.defineProperty(body, "scrollHeight", { value: 1000 });
      Object.defineProperty(body, "clientHeight", { value: 200 });
      await waitFor(() => {
        expect(body.scrollTop).toBe(120);
      });
    });

    it("reports scroll changes to the pane", async () => {
      const onScrollChange = vi.fn();
      render(
        <FilePreview
          fileView={makeFileView()}
          workdir="/work/a"
          onScrollChange={onScrollChange}
        />,
      );
      await waitFor(() => {
        expect(document.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      const body = document.querySelector(
        ".file-pane-preview-body",
      ) as HTMLElement;
      Object.defineProperty(body, "scrollTop", {
        value: 88,
        writable: true,
        configurable: true,
      });
      fireEvent.scroll(body);
      expect(onScrollChange).toHaveBeenCalledWith(88);
    });
  });

  describe("FilePreview copy to clipboard", () => {
    class MockDataTransfer {
      data = new Map<string, string>();
      setData(type: string, value: string) {
        this.data.set(type, value);
      }
      getData(type: string) {
        return this.data.get(type) ?? "";
      }
      get types() {
        return [...this.data.keys()];
      }
    }

    async function renderLines() {
      const { container } = renderPane();
      await waitFor(() => {
        expect(container.querySelectorAll(".file-pane-line").length).toBe(2);
      });
      return container;
    }

    function mockSelection(
      container: HTMLElement,
      hitLines: Element[],
      text: string,
    ) {
      const codeRoot = container.querySelector(
        ".file-pane-code",
      ) as HTMLElement;
      const fakeRange = {
        commonAncestorContainer: codeRoot,
        intersectsNode: (node: Node) => hitLines.includes(node),
      };
      const fakeSel = {
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => fakeRange,
        toString: () => text,
      };
      return vi
        .spyOn(window, "getSelection")
        .mockReturnValue(fakeSel as unknown as Selection);
    }

    function fireCopy(data: MockDataTransfer) {
      const body = document.querySelector(
        ".file-pane-preview-body",
      ) as HTMLElement;
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      body.dispatchEvent(event);
    }

    it("copies single-line selection as plain text without selection tag", async () => {
      const container = await renderLines();
      const lines = container.querySelectorAll(".file-pane-line");
      mockSelection(container, [lines[0]], "const a = 1;");

      const dt = new MockDataTransfer();
      fireCopy(dt);

      expect(dt.types).not.toContain(FILE_SELECTION_CLIPBOARD_MIME);
      expect(dt.getData("text/plain")).toBe("const a = 1;");
    });

    it("copies multi-line selection with a selection tag payload", async () => {
      const container = await renderLines();
      const lines = container.querySelectorAll(".file-pane-line");
      mockSelection(container, [lines[0], lines[1]], "const a = 1;\nconst b = 2;");

      const dt = new MockDataTransfer();
      fireCopy(dt);

      expect(dt.getData("text/plain")).toBe("const a = 1;\nconst b = 2;");
      const raw = dt.getData(FILE_SELECTION_CLIPBOARD_MIME);
      expect(raw).toBeTruthy();
      const payload = parseFileSelectionClipboard(raw);
      expect(payload).not.toBeNull();
      expect(payload?.startLine).toBe(1);
      expect(payload?.endLine).toBe(2);
      expect(payload?.filePath).toBe("/work/a/src/app.ts");
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
