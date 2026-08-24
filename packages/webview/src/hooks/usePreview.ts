import { useCallback, useEffect, useRef } from "react";
import { isLocalhostUrl } from "../utils/isLocalhostUrl";
import type { RemoteForwardRef } from "../stores";
import type { ChatAppCore } from "./useChatAppCore";
import type { PanelHandlers } from "./usePanels";

/**
 * Hostname spellings that name the same remote service through an ssh tunnel:
 * the forward always targets the remote's `localhost:<port>`, so every
 * loopback and all-interfaces spelling refers to the same endpoint (aligned
 * with VS Code's LOCALHOST_ADDRESSES / ALL_INTERFACES_ADDRESSES, whose
 * mapHasAddressLocalhostOrAllInterfaces treats them as one tunnel). Both
 * bracketed and bare IPv6 forms are covered — URL.hostname serializes the
 * former, terminal/Markdown links may carry the latter.
 */
const LOOPBACK_OR_ALL_INTERFACES_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
  "[0:0:0:0:0:0:0:1]",
  "0.0.0.0",
  "::",
  "[::]",
  "0:0:0:0:0:0:0:0",
  "[0:0:0:0:0:0:0:0]",
]);

/**
 * Canonical form of a preview URL for same-link comparison: collapses the
 * loopback/all-interfaces host spellings above to `localhost`, so clicking
 * `http://127.0.0.1:5173/app` after `http://localhost:5173/app` reuses the
 * established tunnel instead of release + re-acquire churn. Non-loopback URLs
 * (external sites) are returned unchanged.
 */
function canonicalForwardUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (LOOPBACK_OR_ALL_INTERFACES_HOSTS.has(u.hostname.toLowerCase()))
      u.hostname = "localhost";
    return u.href;
  } catch {
    return raw;
  }
}

export interface PreviewHandlers {
  handleOpenPreview: (url: string) => void;
  handleOpenRemotePreview: (url: string) => void;
  handleRemotePreviewRetry: () => void;
  handlePreviewNavigate: (url: string) => void;
  /** Desktop only: which preview opener the message/terminal links route to. */
  openPreviewHandler: (url: string) => void;
}

interface UsePreviewParams {
  updatePanelGroup: ChatAppCore["updatePanelGroup"];
  tryOpenPanel: PanelHandlers["tryOpenPanel"];
  acquireForward: PanelHandlers["acquireForward"];
  effectiveHost: string;
  currentForward: RemoteForwardRef | null;
  previewForwardError: string | null;
}

export function usePreview({
  updatePanelGroup,
  tryOpenPanel,
  acquireForward,
  effectiveHost,
  currentForward,
  previewForwardError,
}: UsePreviewParams): PreviewHandlers {
  // Mirrors of the forward state, refreshed on every render. Message is a
  // React.memo component whose DOM click handler captures props.onOpenPreview
  // at mount time — a useCallback that closes over the state values would pin
  // the FIRST values forever and the same-link dedup in
  // handleOpenRemotePreview would never see the established forward. The
  // handlers read the refs at click time instead (same pattern as
  // TerminalPane.tsx:117-119).
  const currentForwardRef = useRef(currentForward);
  currentForwardRef.current = currentForward;
  const previewForwardErrorRef = useRef(previewForwardError);
  previewForwardErrorRef.current = previewForwardError;
  const effectiveHostRef = useRef(effectiveHost);
  useEffect(() => {
    effectiveHostRef.current = effectiveHost;
  }, [effectiveHost]);

  // Desktop only: open/re-target the preview panel. Clicking a localhost link
  // checks the preview item (refused with a hint when space runs out) and loads
  // the URL. Message.tsx only routes localhost links here; all other links go
  // to openExternal.
  const handleOpenPreview = useCallback(
    (url: string) => {
      if (!tryOpenPanel("preview")) return;
      updatePanelGroup({ previewUrl: url });
    },
    [tryOpenPanel, updatePanelGroup],
  );

  // Remote localhost link handler: open the preview panel (creating it when
  // absent) and forward. The same URL — under any loopback/all-interfaces
  // host spelling — is a no-op unless the previous attempt failed (scenario
  // 15/16). Every other click — a different path, a different origin, another
  // service entirely — just re-targets the panel; tunnels are session-scoped
  // and only die when the session is deleted (scenario 18).
  const handleOpenRemotePreview = useCallback(
    (url: string) => {
      if (!tryOpenPanel("preview")) return;
      // Read the refs, not the state values: this callback is captured by the
      // memoized Message component at mount, so closing over state would freeze
      // the first render's values and break the same-link dedup below.
      const current = currentForwardRef.current;
      if (
        current &&
        canonicalForwardUrl(current.originalUrl) === canonicalForwardUrl(url) &&
        previewForwardErrorRef.current === null
      )
        return;
      updatePanelGroup({ forwardError: null, previewUrl: null });
      acquireForward(effectiveHostRef.current, url);
    },
    [tryOpenPanel, acquireForward, updatePanelGroup],
  );

  // Retry after a failed forward (scenario 16): re-request the same tunnel.
  // The host treats a failed entry as gone, so a fresh forward is established.
  const handleRemotePreviewRetry = useCallback(() => {
    const fwd = currentForwardRef.current;
    if (!fwd) return;
    updatePanelGroup({ forwardError: null });
    acquireForward(fwd.host, fwd.originalUrl);
  }, [acquireForward, updatePanelGroup]);

  const openPreviewHandler =
    effectiveHost !== "local" ? handleOpenRemotePreview : handleOpenPreview;

  // Address-bar navigation: public http(s) always load directly. Only remote
  // localhost needs an SSH port-forward (message/terminal clicks already gate
  // on isLocalhostUrl before calling openPreviewHandler).
  const handlePreviewNavigate = useCallback(
    (url: string) => {
      if (effectiveHostRef.current !== "local" && isLocalhostUrl(url)) {
        handleOpenRemotePreview(url);
        return;
      }
      handleOpenPreview(url);
    },
    [handleOpenPreview, handleOpenRemotePreview],
  );

  return {
    handleOpenPreview,
    handleOpenRemotePreview,
    handleRemotePreviewRetry,
    handlePreviewNavigate,
    openPreviewHandler,
  };
}
