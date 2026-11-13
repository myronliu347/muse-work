import { beginSplitDrag, widthFromRightEdge } from "../../muse/splitDrag";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import type { VsCodeApi } from "../../types";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebLinksAddon } from "@xterm/addon-web-links";
import { matchTabStepShortcut } from "../../muse/panelShortcuts";
import { isLocalhostUrl } from "../../utils/isLocalhostUrl";
import { displayHomePath } from "../../utils/filePathDisplay";
import { getOverlayHost } from "../../utils/bodyPortal";
import { workdirTermId } from "../../stores/panelGroupStore";
import { useMuseTheme } from "../../ui/theme";
import "../../styles/TerminalPane.css";

declare global {
  interface Window {
    /** Set by the lazily injected desktop-only terminal chunk (terminal.js). */
    MuseTerminal?: {
      Terminal: typeof XtermTerminal;
      FitAddon: typeof FitAddon;
      WebLinksAddon: typeof WebLinksAddon;
    };
  }
}

const MIN_WIDTH = 320;

export interface TerminalIssueChoice {
  id: string;
  title: string;
  workdir: string;
}

/** Clear the current line, then cd. `\r` is what the PTY treats as Enter. */
export function shellCdInput(workdir: string): string {
  const quoted = `'${workdir.replace(/'/g, `'\\''`)}'`;
  return `\u0015cd ${quoted}\r`;
}

/** Singleton loader for the desktop-only xterm chunk. */
let terminalLibPromise: Promise<NonNullable<Window["MuseTerminal"]>> | null =
  null;

function loadTerminalLib(): Promise<NonNullable<Window["MuseTerminal"]>> {
  if (window.MuseTerminal) return Promise.resolve(window.MuseTerminal);
  if (terminalLibPromise) return terminalLibPromise;
  terminalLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./terminal.js";
    script.onload = () => {
      if (window.MuseTerminal) resolve(window.MuseTerminal);
      else reject(new Error("terminal chunk 未导出 MuseTerminal"));
    };
    script.onerror = () => reject(new Error("terminal.js 加载失败"));
    document.head.appendChild(script);
  });
  // Allow a later retry (e.g. 重启终端) after a failed load.
  terminalLibPromise.catch(() => {
    terminalLibPromise = null;
  });
  return terminalLibPromise;
}

/** Preload the xterm chunk so the first terminal open skips the fetch+parse. */
export function prefetchTerminalLib(): void {
  loadTerminalLib().catch(() => {});
}

/**
 * Sample Radix tokens from a themed element — never `:root` alone.
 * Radix keeps light `--gray-*` on `:root` and dark tokens on `.radix-themes.dark`,
 * so `getComputedStyle(document.documentElement)` always returns the light palette.
 */
type Rgb = { r: number; g: number; b: number };

/** xterm only accepts #hex and rgb()/rgba(). color-mix is rejected and the
 *  fallback is white at 30%, which disappears on a light panel. */
function cssColorToRgb(color: string): Rgb | null {
  const value = color.trim();
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const short = value.match(/^#([\da-f]{3})$/i);
  if (short) {
    const [r, g, b] = short[1].split("");
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    };
  }
  const rgb = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i,
  );
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#010101";
  ctx.fillStyle = value;
  if (ctx.fillStyle === "#010101") return null;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null;
  return { r, g, b };
}

function isLightRgb(color: Rgb): boolean {
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
  return luminance > 0.6;
}

/** Opaque-enough rgba() so xterm can blend the accent onto the panel. */
export function terminalSelectionBackground(
  accent: string,
  background: string,
): string {
  const panel = cssColorToRgb(background);
  const light = panel ? isLightRgb(panel) : false;
  const alpha = light ? 0.38 : 0.32;
  const ink = cssColorToRgb(accent);
  if (!ink) {
    return light
      ? `rgba(0, 0, 0, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`;
  }
  return `rgba(${ink.r}, ${ink.g}, ${ink.b}, ${alpha})`;
}

const readTerminalTheme = (el?: Element | null) => {
  const sample =
    el ??
    document.querySelector(".radix-themes") ??
    document.documentElement;
  const styles = getComputedStyle(sample);
  const pick = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const background =
    pick("--color-background", "") ||
    pick("--gray-2", "") ||
    pick("--gray-1", "#1e1e1e");
  const foreground = pick("--gray-12", "#cccccc");
  const accent = pick("--accent-9", "#c1292e");
  const selectionBackground = terminalSelectionBackground(accent, background);
  return {
    background,
    foreground,
    cursor: foreground,
    selectionBackground,
    selectionInactiveBackground: selectionBackground,
  };
};

type PaneStatus =
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "exited"; detail: string };

export interface TerminalPaneProps {
  vscode: VsCodeApi;
  /** Absolute workdir — scopes the host PTY id and create cwd. */
  workdir?: string;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthPreview?: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  /** Split-view pane identity: tags PTY create requests for cwd resolution. */
  paneId?: string;
  /** Hidden panels stay mounted; the PTY survives hiding. */
  visible: boolean;
  /** Desktop only: route localhost links printed in the terminal into the
   * preview pane, mirroring Message.tsx. Non-localhost links open externally. */
  onOpenPreview?: (url: string) => void;
  /** Overrides the workdir-derived PTY id so each bot tab has its own process. */
  termId?: string;
  /** Set on inactive copies so the visible pane keeps the canonical test ids. */
  testIdScope?: string;
  /** 助手事项：选中后在这个终端里 cd 过去。 */
  issues?: TerminalIssueChoice[];
  homeDir?: string;
  /** Parent-owned rebuild (bot terminal tabs): close this one and open a new
   *  terminal in the current issue/assistant workdir. */
  onRestart?: () => void;
}

/** Embedded PTY terminal panel: xterm.js frontend + node-pty in the desktop host. */
export const TerminalPane: React.FC<TerminalPaneProps> = ({
  vscode,
  width,
  onWidthChange,
  onWidthPreview,
  maxWidth,
  paneId,
  visible,
  workdir,
  onOpenPreview,
  termId: termIdProp,
  testIdScope,
  issues,
  homeDir,
  onRestart,
}) => {
  const tid = (name: string) => (testIdScope ? `${name}-${testIdScope}` : name);
  const [status, setStatus] = useState<PaneStatus>({ kind: "loading" });
  const { effective } = useMuseTheme();
  const asideRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Whether a PTY for this pane is believed alive in the host.
  const liveRef = useRef(false);
  // Per-workdir PTY so switching sessions in the same directory reattaches.
  // An explicit id is one bot-page tab and does not follow later issue switches.
  const termId = termIdProp ?? (workdir ? workdirTermId(workdir) : `term-${paneId ?? "main"}`);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const workdirRef = useRef(workdir);
  workdirRef.current = workdir;
  // The terminal is built once on mount; keep the latest callback so the
  // click handler never sees a stale onOpenPreview closure.
  const onOpenPreviewRef = useRef(onOpenPreview);
  onOpenPreviewRef.current = onOpenPreview;
  // Prop mirrors for the [bootNonce]-deps mount effect below: paneId (and the
  // derived termId) can change without a remount (panel slot keyed by kind),
  // so the effect reads current values from refs (same pattern as
  // onOpenPreviewRef / visibleRef).
  const termIdRef = useRef(termId);
  termIdRef.current = termId;

  const createPty = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (!workdirRef.current) return;
    liveRef.current = true;
    setStatus({ kind: "running" });
    vscode.postMessage({
      command: "desktopTerminalCreate",
      termId,
      workdir: workdirRef.current,
      ...(paneId ? { paneId } : {}),
      cols: term.cols,
      rows: term.rows,
    });
  }, [vscode, termId, paneId]);
  const createPtyRef = useRef(createPty);
  createPtyRef.current = createPty;

  const killPty = useCallback(() => {
    if (!liveRef.current) return;
    liveRef.current = false;
    vscode.postMessage({ command: "desktopTerminalKill", termId });
  }, [vscode, termId]);

  // Bump to re-run the mount flow (chunk-load failure retry).
  const [bootNonce, setBootNonce] = useState(0);

  // Parent-owned rebuild (bot terminal tab): the parent kills this tab's PTY
  // and replaces it with a new terminal in the current workdir, so this pane
  // only has to forward the click.
  const onRestartRef = useRef(onRestart);
  onRestartRef.current = onRestart;

  const restart = useCallback(() => {
    if (onRestartRef.current) {
      onRestartRef.current();
      return;
    }
    if (!termRef.current) {
      // The terminal was never built (chunk load failed) — re-run the mount
      // flow, which retries loadTerminalLib (its failure cache self-clears).
      setStatus({ kind: "loading" });
      setBootNonce((n) => n + 1);
      return;
    }
    killPty();
    termRef.current.reset();
    createPty();
  }, [killPty, createPty]);

  // Mount: load the xterm chunk, build the terminal, wire IO. Unmount does
  // NOT kill the PTY — the host owns its lifecycle (pane close, session
  // switch, app quit) — so a pane moved across rows remounts this component
  // and reattaches to the live PTY (host replays the scrollback buffer).
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (
        msg?.command === "desktopTerminalData" &&
        msg.termId === termIdRef.current
      ) {
        termRef.current?.write(msg.data);
      } else if (
        msg?.command === "desktopTerminalExit" &&
        msg.termId === termIdRef.current
      ) {
        liveRef.current = false;
        setStatus({
          kind: "exited",
          detail: msg.error ?? `进程已退出（退出码 ${msg.exitCode ?? "未知"}）`,
        });
      } else if (msg?.command === "desktopThemeChange") {
        // Host OS / preference paint — re-sample after Radix tokens settle.
        if (termRef.current)
          termRef.current.options.theme = readTerminalTheme(containerRef.current);
      }
    };
    window.addEventListener("message", onMessage);

    loadTerminalLib()
      .then((lib) => {
        if (disposed || !containerRef.current) return;
        const term = new lib.Terminal({
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 12,
          cursorBlink: true,
          theme: readTerminalTheme(containerRef.current),
        });
        const fit = new lib.FitAddon();
        term.loadAddon(fit);
        // Detect plain-text URLs in the output and route clicks the same way
        // Message.tsx does: localhost → preview pane, everything else → the
        // system browser. The handler reads the ref so a changed callback
        // (e.g. after a session switch) is picked up without rebuilding.
        const links = new lib.WebLinksAddon((_event, uri) => {
          if (isLocalhostUrl(uri) && onOpenPreviewRef.current) {
            onOpenPreviewRef.current(uri);
          } else {
            vscode.postMessage({ command: "openExternal", url: uri });
          }
        });
        term.loadAddon(links);
        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fit;
        // Cmd/Ctrl+K clears the screen (mirrors VS Code's terminal clear).
        // Returning false stops xterm from forwarding the chord to the PTY as
        // ordinary input; the handler reads termIdRef so the latest termId is
        // used (matches the termIdRef pattern used by onData / resize).
        term.attachCustomKeyEventHandler((event) => {
          if (matchTabStepShortcut(event)) return false;
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "k"
          ) {
            event.preventDefault();
            event.stopPropagation();
            term.clear();
            vscode.postMessage({
              command: "desktopTerminalClear",
              termId: termIdRef.current,
            });
            return false;
          }
          return true;
        });
        term.onData((data) => {
          vscode.postMessage({
            command: "desktopTerminalInput",
            termId: termIdRef.current,
            data,
          });
        });
        resizeObserver = new ResizeObserver(() => {
          const el = containerRef.current;
          // Hidden (display:none) panels report zero size; fitting then would
          // collapse the PTY to 0×0. The observer fires again on re-show.
          if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
          fit.fit();
          if (liveRef.current) {
            vscode.postMessage({
              command: "desktopTerminalResize",
              termId: termIdRef.current,
              cols: term.cols,
              rows: term.rows,
            });
          }
        });
        resizeObserver.observe(containerRef.current);
        fit.fit();
        if (visibleRef.current) {
          createPtyRef.current();
          // 首次打开走这条路径（chunk 异步加载完成后才建终端）——聚焦，
          // 对齐 VS Code 打开终端面板的行为。
          term.focus();
        }
      })
      .catch((err) => {
        if (!disposed) {
          setStatus({
            kind: "exited",
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      window.removeEventListener("message", onMessage);
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // vscode is a module singleton, so this still only re-runs on bootNonce.
  }, [bootNonce, vscode]);

  // Keep the canvas in sync with Muse light/dark (in-app preference or system).
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = readTerminalTheme(containerRef.current);
  }, [effective]);

  // Visibility / workdir (termId) changes. Each workdir keeps its own host PTY.
  // Switching sessions in the same directory must NOT reset or recreate.
  // Switching workdir reattaches to the other PTY without killing the old one.
  const prevRef = useRef({ visible, termId, workdir });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, termId, workdir };
    const becameVisible = visible && !prev.visible;
    const termChanged = prev.termId !== termId;
    const workdirChangedSameTerm =
      !termChanged && prev.workdir !== workdir && Boolean(prev.workdir);

    if (termChanged) {
      liveRef.current = false;
      termRef.current?.reset();
      if (visible && workdir) {
        createPty();
        termRef.current?.focus();
      } else if (!workdir) {
        setStatus({ kind: "loading" });
      }
    } else if (workdirChangedSameTerm) {
      // Same termId string but cwd text changed — rebuild this PTY only.
      killPty();
      termRef.current?.reset();
      if (visible) createPty();
    } else if (becameVisible) {
      // 用户主动打开终端面板（勾选/快捷键）——聚焦终端，对齐 VS Code 行为。
      if (!liveRef.current) createPty();
      termRef.current?.focus();
    }
  }, [visible, termId, workdir, killPty, createPty]);

  // Drag the left edge: the right edge is the anchor, so the width is whatever
  // the pointer leaves. The live width only touches the DOM; the width lands in
  // state (and the panel snapshot) once, on release.
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const right = asideRef.current?.getBoundingClientRect().right ?? 0;
    beginSplitDrag(e, {
      startValue: width,
      value: (ev) =>
        widthFromRightEdge(right, ev, (next) =>
          Math.min(Math.max(next, MIN_WIDTH), maxWidth),
        ),
      preview: (next) => {
        if (asideRef.current) asideRef.current.style.width = `${next}px`;
        onWidthPreview?.(next);
      },
      commit: onWidthChange,
    });
  };

  return (
    <aside
      ref={asideRef}
      className="preview-pane terminal-pane"
      style={{ width }}
      data-testid={tid("terminal-pane")}
    >
      <div className="preview-pane-drag-handle" onPointerDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url">终端</span>
          {issues && issues.some((issue) => issue.workdir) ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button
                  type="button"
                  className="terminal-issue-select"
                  data-testid={tid("terminal-issue-select")}
                  aria-label="前往事项目录"
                >
                  <span>前往目录</span>
                  <i className="codicon codicon-chevron-down" aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                size="1"
                variant="soft"
                color="gray"
                highContrast
                align="start"
                sideOffset={4}
                container={getOverlayHost()}
                data-testid={tid("terminal-issue-menu")}
              >
                {issues.map((issue) => {
                  const path = displayHomePath(issue.workdir, homeDir);
                  return (
                    <DropdownMenu.Item
                      key={issue.id}
                      data-testid={tid(`terminal-issue-option-${issue.id}`)}
                      disabled={!issue.workdir}
                      onSelect={() => {
                        if (!issue.workdir) return;
                        vscode.postMessage({
                          command: "desktopTerminalInput",
                          termId,
                          data: shellCdInput(issue.workdir),
                        });
                      }}
                    >
                      <span className="terminal-issue-option">
                        <span className="terminal-issue-option-title">{issue.title}</span>
                        <span className="terminal-issue-option-workdir" title={path}>
                          <span>{path || "没有工作目录"}</span>
                        </span>
                      </span>
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          ) : null}
          <span className="terminal-pane-spacer" />
          <button
            className="preview-pane-button"
            title="重启终端"
            data-testid={tid("terminal-restart")}
            onClick={restart}
          >
            <i className="codicon codicon-debug-restart" />
          </button>
        </div>
        <div
          className="terminal-pane-body"
          ref={containerRef}
          data-testid={tid("terminal-body")}
        >
          {status.kind === "loading" && (
            <div className="desktop-panel-placeholder">终端加载中…</div>
          )}
          {status.kind === "exited" && (
            <div className="desktop-panel-placeholder terminal-pane-exited">
              <span>{status.detail}</span>
              <button
                className="preview-pane-button"
                data-testid={tid("terminal-retry")}
                onClick={restart}
              >
                重启终端
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default TerminalPane;
