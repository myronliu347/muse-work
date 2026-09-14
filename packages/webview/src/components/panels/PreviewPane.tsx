import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VsCodeApi } from "../../types";
import { pathToFileUrl } from "../../utils/pathToFileUrl";

/**
 * Desktop-only preview pane: renders a localhost dev server in a
 * sandboxed <webview> next to the chat, with an element picker whose comments
 * are appended to the chat input so several can be edited and sent together.
 *
 * Communication with the picker preload inside the guest:
 *   host → guest : wv.send('wave-picker', { action, palette? })
 *   guest → host : 'ipc-message' DOM event, channel 'wave-picker'
 */

/** The subset of Electron's <webview> DOM API that PreviewPane uses. */
export interface WebviewTagElement extends HTMLElement {
  send(channel: string, ...args: unknown[]): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
  /** Bypass the HTTP cache entirely — the refresh button uses this so a dev
   * server's stale cache headers can't hide the latest build. */
  reloadIgnoringCache(): void;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

export interface PreviewComment {
  type?: string;
  url?: string;
  selector?: string;
  summary?: string;
  text?: string;
  comment?: string;
}

/** User-visible markdown for a picker comment — appended to the chat input. */
export function formatPreviewComment(msg: PreviewComment): string {
  const location = [
    msg.summary ? `\`${msg.summary}\`` : "",
    msg.text ? `「${msg.text}」` : "",
  ]
    .filter(Boolean)
    .join("");
  const lines = [
    `**预览评论** · ${msg.url ?? ""}`,
    `${location} · \`${msg.selector ?? ""}\``,
    "",
    msg.comment ?? "",
  ];
  return lines.join("\n");
}

/**
 * Rewrite a picker comment's URL from the forwarded address the guest is
 * actually showing back to the original address the user cares about (scenario
 * 17). The guest loads `http://127.0.0.1:<localPort>/path` for a tunnel
 * forwarding `http://localhost:<remotePort>/path`; comments must record the
 * latter so they read naturally in the chat and stay valid after the tunnel
 * dies. Only the origin is remapped — path/search/hash pass through unchanged,
 * and any URL that isn't on the forwarded origin is returned untouched.
 */
export function rewriteCommentUrl(
  commentUrl: string,
  forwardedBase: string,
  originalBase: string,
): string {
  try {
    const fwd = new URL(forwardedBase);
    const orig = new URL(originalBase);
    const comment = new URL(commentUrl);
    if (comment.origin !== fwd.origin) return commentUrl;
    return `${orig.protocol}//${orig.host}${comment.pathname}${comment.search}${comment.hash}`;
  } catch {
    return commentUrl;
  }
}

/** Normalize address-bar input into an absolute http(s) or local file URL, or null. */
export function normalizePreviewAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    // Local file preview: file:// URLs and absolute filesystem paths load
    // directly in the guest (file panel's "open in browser" routes here too).
    if (/^file:\/\//i.test(trimmed)) return new URL(trimmed).href;
    if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) {
      return new URL(pathToFileUrl(trimmed)).href;
    }
    // Only treat as absolute when a real scheme:// is present. `host:port`
    // must NOT be mistaken for a scheme (e.g. localhost:5173).
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

const MIN_WIDTH = 320;

/** Colors the guest picker can't read cross-origin — sampled from the host theme. */
const readPalette = (el?: Element | null): Record<string, string> => {
  const sample =
    el ??
    document.querySelector(".radix-themes") ??
    document.documentElement;
  const styles = getComputedStyle(sample);
  const pick = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: pick("--accent-9", "#c1292e"),
    accentForeground: "#ffffff",
    foreground: pick("--gray-12", "#cccccc"),
    background:
      pick("--color-background", "") ||
      pick("--gray-2", "") ||
      pick("--gray-1", "#1e1e1e"),
    border: pick("--gray-6", "rgba(128, 128, 128, 0.35)"),
    inputBackground: pick("--gray-3", "#3c3c3c"),
    inputForeground: pick("--gray-12", "#cccccc"),
  };
};

export interface PreviewPaneProps {
  /** Guest URL; omit/empty to show toolbar + empty placeholder only. */
  url?: string | null;
  vscode: VsCodeApi;
  onClose: () => void;
  /** Controlled width (px); the parent enforces the conversation-area minimum. */
  width: number;
  onWidthChange: (width: number) => void;
  /** Upper bound so the conversation area keeps its minimum width. */
  maxWidth: number;
  /** Receives a formatted picker comment; appended to this pane's chat input. */
  onAddComment?: (text: string) => void;
  /** Remote sessions: the original (pre-forward) URL the pane is showing; picker
   * comments are rewritten back to it (scenario 17). Undefined for local URLs. */
  originalUrl?: string;
  /** Remote sessions: re-establish the port forward on error retry (scenario
   * 16). Undefined for local URLs, where the retry reloads the guest instead. */
  onRetry?: () => void;
  /** Address-bar Enter: parent opens / forwards the URL (sets previewUrl). */
  onNavigate?: (url: string) => void;
  /** Empty-body hint when no page is loaded. */
  forwardError?: string | null;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  url,
  vscode,
  width,
  onWidthChange,
  maxWidth,
  onAddComment,
  originalUrl,
  onRetry,
  onNavigate,
  forwardError,
}) => {
  const initialUrl = url ?? "";
  const [displayUrl, setDisplayUrl] = useState(initialUrl);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [addressFocused, setAddressFocused] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickerActive, setPickerActive] = useState(false);
  const [pickerUnsupported, setPickerUnsupported] = useState(false);
  const webviewRef = useRef<WebviewTagElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  // URL the guest is currently showing — follows in-guest navigation.
  const currentUrlRef = useRef(initialUrl);
  // webview.send() before dom-ready is silently dropped, so gate on it.
  const domReadyRef = useRef(false);
  // Guest preload announces { type: 'ready' }; if it never arrives the page
  // can't host the picker (injection failed).
  const pickerReadyRef = useRef(false);
  const pickerActiveRef = useRef(pickerActive);
  pickerActiveRef.current = pickerActive;
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;
  // Prop mirrors for the []-deps wiring effect below: the ipc handler runs
  // long after the effect captured its closures, so it reads current values
  // from refs (same pattern as onAddCommentRef).
  const urlPropRef = useRef(url ?? "");
  urlPropRef.current = url ?? "";
  const originalUrlRef = useRef(originalUrl);
  originalUrlRef.current = originalUrl;

  const hasPage = Boolean(displayUrl);

  const syncHistoryButtons = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) {
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }
    try {
      setCanGoBack(Boolean(wv.canGoBack?.()));
      setCanGoForward(Boolean(wv.canGoForward?.()));
    } catch {
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }, []);

  const sendPicker = useCallback((action: "activate" | "deactivate") => {
    const wv = webviewRef.current;
    if (!wv || !domReadyRef.current) return;
    wv.send(
      "wave-picker",
      action === "activate"
        ? { action, palette: readPalette(asideRef.current) }
        : { action },
    );
  }, []);

  const deactivatePicker = useCallback(() => {
    pickerActiveRef.current = false;
    setPickerActive(false);
    sendPicker("deactivate");
  }, [sendPicker]);

  // Wire the <webview> once. `src` is set imperatively (never from JSX) so
  // React re-renders can't reload the guest; later navigations use loadURL.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onDomReady = () => {
      domReadyRef.current = true;
      syncHistoryButtons();
      // Manual refresh keeps the picker on: the fresh guest preload starts
      // inactive, so re-send. (Real navigations already reset the toggle.)
      if (pickerActiveRef.current) sendPicker("activate");
    };
    const onDidNavigate = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        setDisplayUrl(navUrl);
      }
      setLoadError(null);
      syncHistoryButtons();
      // Fresh document → guest preload restarts inactive.
      pickerReadyRef.current = false;
      pickerActiveRef.current = false;
      setPickerActive(false);
      setPickerUnsupported(false);
    };
    const onDidNavigateInPage = (e: Event) => {
      const navUrl = (e as { url?: string }).url;
      if (navUrl) {
        currentUrlRef.current = navUrl;
        setDisplayUrl(navUrl);
      }
      syncHistoryButtons();
      // SPA navigation keeps the SAME preload alive — tell it to stand down.
      deactivatePicker();
    };
    const onDidFailLoad = (e: Event) => {
      const detail = e as {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false) return;
      if (detail.errorCode === -3) return; // ERR_ABORTED: superseded by a newer load
      setLoadError(detail.errorDescription || "ERR_FAILED");
    };
    const onIpcMessage = (e: Event) => {
      const { channel, args } = e as unknown as {
        channel: string;
        args: PreviewComment[];
      };
      if (channel !== "wave-picker") return;
      const msg = args?.[0];
      if (msg?.type === "ready") {
        pickerReadyRef.current = true;
        return;
      }
      if (msg?.type === "submit" && msg.comment) {
        // Append to the chat input instead of sending: the user batches
        // several element comments and sends them together. The picker
        // stays active for the next pick. The guest reports its actual
        // (forwarded) address — rewrite back to the original for remote
        // tunnels so the comment records the URL the user clicked (scenario
        // 17); local previews pass through unchanged.
        const originalBase = originalUrlRef.current;
        const rewritten = originalBase
          ? rewriteCommentUrl(msg.url ?? "", urlPropRef.current, originalBase)
          : (msg.url ?? "");
        onAddCommentRef.current?.(
          formatPreviewComment({ ...msg, url: rewritten }),
        );
      }
    };

    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigateInPage);
    wv.addEventListener("did-fail-load", onDidFailLoad);
    wv.addEventListener("ipc-message", onIpcMessage);
    if (urlPropRef.current) {
      wv.setAttribute("src", urlPropRef.current);
    }
    return () => {
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-navigate", onDidNavigate);
      wv.removeEventListener("did-navigate-in-page", onDidNavigateInPage);
      wv.removeEventListener("did-fail-load", onDidFailLoad);
      wv.removeEventListener("ipc-message", onIpcMessage);
    };
    // deactivatePicker/sendPicker are stable useCallbacks, so this still only
    // runs once per mount.
  }, [deactivatePicker, sendPicker, syncHistoryButtons]);

  // Keep address draft in sync with navigations unless the user is editing.
  useEffect(() => {
    if (!addressFocused) setAddressDraft(displayUrl);
  }, [displayUrl, addressFocused]);

  // Navigate when a different localhost link is clicked while the panel is open.
  const lastUrlRef = useRef(url ?? "");
  useEffect(() => {
    const next = url ?? "";
    if (next === lastUrlRef.current) return;
    lastUrlRef.current = next;
    currentUrlRef.current = next;
    setDisplayUrl(next);
    setLoadError(null);
    if (!next) {
      syncHistoryButtons();
      return;
    }
    const wv = webviewRef.current;
    if (!wv) return;
    if (domReadyRef.current) {
      void wv.loadURL(next);
    } else {
      // Guest hasn't finished its first load yet — retarget the initial src.
      wv.setAttribute("src", next);
    }
  }, [url, syncHistoryButtons]);

  const togglePicker = () => {
    if (!hasPage) return;
    const next = !pickerActiveRef.current;
    if (next && (!domReadyRef.current || !pickerReadyRef.current)) {
      // Guest preload never announced itself — injection failed.
      setPickerUnsupported(true);
      return;
    }
    setPickerUnsupported(false);
    pickerActiveRef.current = next;
    setPickerActive(next);
    sendPicker(next ? "activate" : "deactivate");
  };

  // Transient "picker unsupported" hint.
  useEffect(() => {
    if (!pickerUnsupported) return;
    const timer = setTimeout(() => setPickerUnsupported(false), 3000);
    return () => clearTimeout(timer);
  }, [pickerUnsupported]);

  const handleRefresh = () => {
    if (!hasPage) return;
    setLoadError(null);
    // Force-refresh: plain reload() honors the HTTP cache, which can hide a
    // dev server's latest output behind stale cache headers.
    webviewRef.current?.reloadIgnoringCache();
  };

  const handleOpenExternal = () => {
    const target = currentUrlRef.current || displayUrl;
    if (!target) return;
    vscode.postMessage({ command: "openExternal", url: target });
  };

  const handleAddressSubmit = () => {
    const normalized = normalizePreviewAddress(addressDraft);
    if (!normalized) return;
    setAddressDraft(normalized);
    // Always navigate in-pane first so the guest loads even if parent state
    // is delayed / missing (e.g. draft without a workdir group key). Parent
    // onNavigate only syncs previewUrl / triggers remote localhost forward.
    currentUrlRef.current = normalized;
    lastUrlRef.current = normalized;
    setDisplayUrl(normalized);
    setLoadError(null);
    const wv = webviewRef.current;
    if (wv) {
      if (domReadyRef.current || wv.getAttribute("src")) {
        void wv.loadURL(normalized);
      } else {
        wv.setAttribute("src", normalized);
      }
    }
    onNavigate?.(normalized);
  };

  // Dragging the left edge resizes this panel: the panels to the right keep
  // their widths, so the aside's right edge is fixed for the drag.
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = "var(--accent-9)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <aside
      ref={asideRef}
      className="preview-pane"
      style={{ width }}
      data-testid="preview-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <button
            type="button"
            className="preview-pane-button"
            title="后退"
            data-testid="preview-back"
            disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack()}
          >
            <i className="codicon codicon-arrow-left" />
          </button>
          <button
            type="button"
            className="preview-pane-button"
            title="前进"
            data-testid="preview-forward"
            disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()}
          >
            <i className="codicon codicon-arrow-right" />
          </button>
          <button
            type="button"
            className="preview-pane-button"
            title="刷新"
            data-testid="preview-refresh"
            disabled={!hasPage}
            onClick={handleRefresh}
          >
            <i className="codicon codicon-refresh" />
          </button>
          <input
            type="text"
            className="preview-pane-address"
            data-testid="preview-address"
            value={addressDraft}
            placeholder="输入地址后回车访问"
            spellCheck={false}
            onFocus={() => setAddressFocused(true)}
            onBlur={() => setAddressFocused(false)}
            onChange={(e) => setAddressDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddressSubmit();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <button
            type="button"
            className="preview-pane-button"
            title="在浏览器中打开"
            data-testid="preview-open-external"
            disabled={!hasPage}
            onClick={handleOpenExternal}
          >
            <i className="codicon codicon-link-external" />
          </button>
          <button
            type="button"
            className={`preview-pane-button${pickerActive ? " active" : ""}`}
            title="选择元素并评论"
            aria-pressed={pickerActive}
            data-testid="preview-picker-toggle"
            disabled={!hasPage}
            onClick={togglePicker}
          >
            <i className="codicon codicon-inspect" />
          </button>
        </div>
        {pickerUnsupported && (
          <div
            className="preview-pane-hint"
            data-testid="preview-picker-unsupported"
          >
            该页面暂不支持元素拾取
          </div>
        )}
        <div className="preview-pane-body">
          <webview
            ref={webviewRef}
            className="preview-pane-webview"
            {...(window.wavePickerPreloadPath
              ? { preload: window.wavePickerPreloadPath }
              : {})}
            webpreferences="sandbox=yes, contextIsolation=yes"
          />
          {!hasPage && !loadError && (
            <div
              className="desktop-panel-placeholder"
              data-testid="preview-empty"
            >
              {forwardError ? (
                <>
                  <span>远程预览加载失败：{forwardError}</span>
                  {onRetry && (
                    <button
                      type="button"
                      className="preview-pane-button"
                      data-testid="preview-forward-retry"
                      onClick={onRetry}
                    >
                      重试
                    </button>
                  )}
                </>
              ) : (
                <>输入地址回车访问，或点击消息/终端中的链接</>
              )}
            </div>
          )}
          {loadError && (
            <div className="preview-pane-error" data-testid="preview-error">
              <span>页面加载失败：{loadError}</span>
              <button
                type="button"
                className="preview-pane-button"
                data-testid="preview-retry"
                onClick={() => {
                  setLoadError(null);
                  (onRetry ?? handleRefresh)();
                }}
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default PreviewPane;
