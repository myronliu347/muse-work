/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { TerminalPane } from "../../src/components/panels/TerminalPane";
import { workdirTermId } from "../../src/stores/panelGroupStore";
import { createMockVscode, sendCommand } from "./test-utils";

class MockTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown>;
  written: string[] = [];
  resetCount = 0;
  clearCount = 0;
  disposed = false;
  addons: unknown[] = [];
  private dataCb: ((data: string) => void) | null = null;
  private keyHandler: ((e: { metaKey: boolean; ctrlKey: boolean; key: string; preventDefault(): void; stopPropagation(): void }) => boolean) | null = null;
  constructor(options: Record<string, unknown>) {
    this.options = options;
    mockTerminals.push(this);
  }
  loadAddon(addon: unknown) {
    this.addons.push(addon);
  }
  open() {}
  focus = vi.fn();
  onData(cb: (data: string) => void) {
    this.dataCb = cb;
  }
  write(data: string) {
    this.written.push(data);
  }
  reset() {
    this.resetCount++;
  }
  clear() {
    this.clearCount++;
  }
  dispose() {
    this.disposed = true;
  }
  attachCustomKeyEventHandler(
    handler: (e: {
      metaKey: boolean;
      ctrlKey: boolean;
      key: string;
      preventDefault(): void;
      stopPropagation(): void;
    }) => boolean,
  ) {
    this.keyHandler = handler;
  }
  simulateInput(data: string) {
    this.dataCb?.(data);
  }
  simulateKey(e: { metaKey?: boolean; ctrlKey?: boolean; key: string }) {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const handled =
      this.keyHandler?.({
        metaKey: e.metaKey ?? false,
        ctrlKey: e.ctrlKey ?? false,
        key: e.key,
        preventDefault,
        stopPropagation,
      }) ?? true;
    return { handled, preventDefault, stopPropagation };
  }
}

/** Mirrors @xterm/addon-web-links: ctor captures the click handler. */
class MockWebLinksAddon {
  handler: ((event: MouseEvent, uri: string) => void) | null;
  constructor(handler?: (event: MouseEvent, uri: string) => void) {
    this.handler = handler ?? null;
  }
  activate() {}
  dispose() {}
}

const mockTerminals: MockTerminal[] = [];
const DEFAULT_WD = "/tmp/work";
const defaultTermId = workdirTermId(DEFAULT_WD);

function renderPane(options?: {
  paneId?: string;
  visible?: boolean;
  workdir?: string | undefined;
  onClose?: () => void;
  onOpenPreview?: (url: string) => void;
  /** When true, omit workdir entirely (no default). */
  noWorkdir?: boolean;
}) {
  const vscode = createMockVscode();
  const onClose = options?.onClose ?? vi.fn();
  const onOpenPreview = options?.onOpenPreview ?? vi.fn();
  const workdir = options?.noWorkdir
    ? undefined
    : (options?.workdir ?? DEFAULT_WD);
  const result = render(
    <TerminalPane
      vscode={vscode}
      width={420}
      onWidthChange={vi.fn()}
      maxWidth={716}
      onClose={onClose}
      paneId={options?.paneId}
      visible={options?.visible ?? true}
      workdir={workdir}
      onOpenPreview={onOpenPreview}
    />,
  );
  const rerenderWith = (props: {
    visible?: boolean;
    workdir?: string | undefined;
  }) =>
    result.rerender(
      <TerminalPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={onClose}
        paneId={options?.paneId}
        visible={props.visible ?? true}
        workdir={"workdir" in props ? props.workdir : workdir}
        onOpenPreview={onOpenPreview}
      />,
    );
  return { ...result, rerenderWith, vscode, onClose, onOpenPreview, workdir };
}

const postsOf = (
  vscode: ReturnType<typeof createMockVscode>,
  command: string,
) =>
  vscode.postMessage.mock.calls
    .filter(([msg]) => msg.command === command)
    .map(([msg]) => msg);

beforeEach(() => {
  mockTerminals.length = 0;
  window.WaveTerminal = {
    Terminal: MockTerminal,
    FitAddon: class {
      fit = vi.fn();
    },
    WebLinksAddon: MockWebLinksAddon as unknown as NonNullable<
      Window["WaveTerminal"]
    >["WebLinksAddon"],
  } as unknown as NonNullable<Window["WaveTerminal"]>;
});

afterEach(() => {
  delete window.WaveTerminal;
});

describe("TerminalPane", () => {
  it("uses term-wd encoded workdir as termId", async () => {
    const { vscode } = renderPane({
      paneId: "pane-1",
      workdir: "/w/a",
    });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toEqual([
      {
        command: "desktopTerminalCreate",
        termId: workdirTermId("/w/a"),
        workdir: "/w/a",
        paneId: "pane-1",
        cols: 80,
        rows: 24,
      },
    ]);
  });

  it("does not create a PTY without workdir", async () => {
    const { vscode } = renderPane({ noWorkdir: true });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(0);
  });

  it("hidden mount keeps the PTY unstarted; re-show creates it", async () => {
    const { vscode, rerenderWith } = renderPane({ visible: false });
    await act(async () => {});
    expect(mockTerminals).toHaveLength(1);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(0);
    rerenderWith({ visible: true });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
  });

  it("focuses the terminal on first open (visible mount after chunk load)", async () => {
    renderPane();
    await act(async () => {});
    expect(mockTerminals[0].focus).toHaveBeenCalledTimes(1);
  });

  it("focuses the terminal when the panel becomes visible, not on hidden mount", async () => {
    const { rerenderWith } = renderPane({ visible: false });
    await act(async () => {});
    expect(mockTerminals[0].focus).not.toHaveBeenCalled();
    rerenderWith({ visible: true });
    await act(async () => {});
    expect(mockTerminals[0].focus).toHaveBeenCalledTimes(1);
  });

  it("relays host output into xterm and keystrokes back to the host", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    sendCommand("desktopTerminalData", {
      termId: defaultTermId,
      data: "hello$ ",
    });
    expect(mockTerminals[0].written).toContain("hello$ ");
    act(() => mockTerminals[0].simulateInput("ls\n"));
    expect(postsOf(vscode, "desktopTerminalInput")).toEqual([
      {
        command: "desktopTerminalInput",
        termId: defaultTermId,
        data: "ls\n",
      },
    ]);
  });

  it("ignores terminal messages addressed to another termId", async () => {
    renderPane({ paneId: "pane-1", workdir: "/w/a" });
    await act(async () => {});
    sendCommand("desktopTerminalData", {
      termId: workdirTermId("/w/other"),
      data: "nope",
    });
    expect(mockTerminals[0].written).toHaveLength(0);
  });

  it("shows the exited state with restart on desktopTerminalExit", async () => {
    renderPane();
    await act(async () => {});
    sendCommand("desktopTerminalExit", {
      termId: defaultTermId,
      exitCode: 137,
    });
    expect(screen.getByText("进程已退出（退出码 137）")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-retry")).toBeInTheDocument();
  });

  it("shows the error detail when the host reports a spawn failure", async () => {
    renderPane();
    await act(async () => {});
    sendCommand("desktopTerminalExit", {
      termId: defaultTermId,
      error: "终端启动失败：boom",
    });
    expect(screen.getByText("终端启动失败：boom")).toBeInTheDocument();
  });

  it("Cmd+K clears the xterm buffer, posts desktopTerminalClear, and swallows the key", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    act(() => {
      mockTerminals[0].simulateKey({ metaKey: true, key: "k" });
    });
    expect(mockTerminals[0].clearCount).toBe(1);
    expect(postsOf(vscode, "desktopTerminalInput")).toHaveLength(0);
    expect(postsOf(vscode, "desktopTerminalClear")).toEqual([
      { command: "desktopTerminalClear", termId: defaultTermId },
    ]);
  });

  it("Ctrl+K clears on Windows-style terminals", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    act(() => {
      mockTerminals[0].simulateKey({ ctrlKey: true, key: "K" });
    });
    expect(mockTerminals[0].clearCount).toBe(1);
    expect(postsOf(vscode, "desktopTerminalClear")).toEqual([
      { command: "desktopTerminalClear", termId: defaultTermId },
    ]);
    expect(postsOf(vscode, "desktopTerminalInput")).toHaveLength(0);
  });

  it("plain keys are not swallowed: handler passes them through", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    let result: { handled: boolean; preventDefault: ReturnType<typeof vi.fn> };
    act(() => {
      result = mockTerminals[0].simulateKey({ key: "a" });
    });
    expect(result.handled).toBe(true);
    expect(mockTerminals[0].clearCount).toBe(0);
    expect(postsOf(vscode, "desktopTerminalClear")).toHaveLength(0);
    // xterm then forwards the key as normal input — the host still gets it.
    act(() => mockTerminals[0].simulateInput("a"));
    expect(postsOf(vscode, "desktopTerminalInput")).toEqual([
      { command: "desktopTerminalInput", termId: defaultTermId, data: "a" },
    ]);
  });

  it("restart kills then re-creates the PTY and resets the xterm buffer", async () => {
    const { vscode } = renderPane();
    await act(async () => {});
    fireEvent.click(screen.getByTestId("terminal-restart"));
    expect(postsOf(vscode, "desktopTerminalKill")).toEqual([
      { command: "desktopTerminalKill", termId: defaultTermId },
    ]);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(2);
    expect(mockTerminals[0].resetCount).toBe(1);
  });

  it("same workdir session switch does not reset or recreate PTY", async () => {
    const { vscode, rerenderWith } = renderPane({ workdir: "/w/a" });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
    // Rerender with same workdir (session would have changed in ChatApp).
    rerenderWith({ workdir: "/w/a" });
    expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(0);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
    expect(mockTerminals[0].resetCount).toBe(0);
  });

  it("workdir switch reattaches a different PTY without killing the old one", async () => {
    const { vscode, rerenderWith } = renderPane({ workdir: "/w/a" });
    await act(async () => {});
    rerenderWith({ workdir: "/w/b" });
    expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(0);
    expect(postsOf(vscode, "desktopTerminalCreate")).toEqual([
      expect.objectContaining({
        termId: workdirTermId("/w/a"),
        workdir: "/w/a",
      }),
      expect.objectContaining({
        termId: workdirTermId("/w/b"),
        workdir: "/w/b",
      }),
    ]);
    expect(mockTerminals[0].resetCount).toBe(1);
  });

  it("workdir switch on a hidden terminal does not kill or create", async () => {
    const { vscode, rerenderWith } = renderPane({
      visible: false,
      workdir: "/w/a",
    });
    await act(async () => {});
    rerenderWith({ visible: true, workdir: "/w/a" });
    await act(async () => {});
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
    rerenderWith({ visible: false, workdir: "/w/a" });
    rerenderWith({ visible: false, workdir: "/w/b" });
    expect(postsOf(vscode, "desktopTerminalKill")).toHaveLength(0);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
  });

  it("unmount disposes the terminal but leaves the PTY alive for reattach", async () => {
    const { vscode, unmount } = renderPane();
    await act(async () => {});
    unmount();
    expect(postsOf(vscode, "desktopTerminalKill")).toEqual([]);
    expect(mockTerminals[0].disposed).toBe(true);
  });

  it("samples xterm theme from the pane, not :root light tokens", async () => {
    document.documentElement.style.setProperty("--color-background", "#f9f9f9");
    document.documentElement.style.setProperty("--gray-2", "#f9f9f9");
    document.documentElement.style.setProperty("--gray-12", "#202020");
    renderPane();
    await act(async () => {});
    const body = screen.getByTestId("terminal-body");
    body.style.setProperty("--color-background", "#191919");
    body.style.setProperty("--gray-2", "#191919");
    body.style.setProperty("--gray-12", "#eeeeee");
    body.style.setProperty("--accent-9", "#e5484d");
    sendCommand("desktopThemeChange", {});
    const after = mockTerminals[0].options.theme as {
      background: string;
      foreground: string;
    };
    expect(after.background).toBe("#191919");
    expect(after.foreground).toBe("#eeeeee");
    document.documentElement.style.removeProperty("--color-background");
    document.documentElement.style.removeProperty("--gray-2");
    document.documentElement.style.removeProperty("--gray-12");
  });

  const linkHandlerOf = (term: MockTerminal) =>
    (
      term.addons.find((a) => a instanceof MockWebLinksAddon) as
        | MockWebLinksAddon
        | undefined
    )?.handler;

  it("routes a localhost link in the terminal to the preview pane", async () => {
    const onOpenPreview = vi.fn();
    const { vscode } = renderPane({ onOpenPreview });
    await act(async () => {});
    const handler = linkHandlerOf(mockTerminals[0]);
    expect(handler).toBeTruthy();

    act(() => handler!({} as MouseEvent, "http://localhost:5173/app"));

    expect(onOpenPreview).toHaveBeenCalledWith("http://localhost:5173/app");
    expect(postsOf(vscode, "openExternal")).toHaveLength(0);
  });

  it("routes a non-localhost link in the terminal to the system browser", async () => {
    const onOpenPreview = vi.fn();
    const { vscode } = renderPane({ onOpenPreview });
    await act(async () => {});
    act(() =>
      linkHandlerOf(mockTerminals[0])!(
        {} as MouseEvent,
        "https://example.com/docs",
      ),
    );

    expect(onOpenPreview).not.toHaveBeenCalled();
    expect(postsOf(vscode, "openExternal")).toEqual([
      { command: "openExternal", url: "https://example.com/docs" },
    ]);
  });

  it("falls back to the system browser for localhost when no onOpenPreview", async () => {
    const vscode = createMockVscode();
    render(
      <TerminalPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={vi.fn()}
        visible={true}
        workdir={DEFAULT_WD}
      />,
    );
    await act(async () => {});
    act(() =>
      linkHandlerOf(mockTerminals[0])!(
        {} as MouseEvent,
        "http://127.0.0.1:3000",
      ),
    );

    expect(postsOf(vscode, "openExternal")).toEqual([
      { command: "openExternal", url: "http://127.0.0.1:3000" },
    ]);
  });

  it("shows an actionable error when the terminal chunk fails to load, and retry rebuilds", async () => {
    delete window.WaveTerminal;
    const vscode = createMockVscode();
    render(
      <TerminalPane
        vscode={vscode}
        width={420}
        onWidthChange={vi.fn()}
        maxWidth={716}
        onClose={vi.fn()}
        visible={true}
        workdir={DEFAULT_WD}
      />,
    );
    await act(async () => {});
    const script = document.head.querySelector('script[src="./terminal.js"]');
    expect(script).not.toBeNull();
    await act(async () => {
      script!.dispatchEvent(new Event("error"));
    });
    expect(screen.getByText("terminal.js 加载失败")).toBeInTheDocument();

    window.WaveTerminal = {
      Terminal: MockTerminal,
      FitAddon: class {
        fit = vi.fn();
      },
      WebLinksAddon: MockWebLinksAddon as unknown as NonNullable<
        Window["WaveTerminal"]
      >["WebLinksAddon"],
    } as unknown as NonNullable<Window["WaveTerminal"]>;
    fireEvent.click(screen.getByTestId("terminal-retry"));
    await act(async () => {});
    expect(mockTerminals).toHaveLength(1);
    expect(postsOf(vscode, "desktopTerminalCreate")).toHaveLength(1);
    script!.remove();
  });
});
