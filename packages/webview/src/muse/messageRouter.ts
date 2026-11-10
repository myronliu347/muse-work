import type React from "react";
import type {
  ChatState,
  ChatAction,
  VsCodeApi,
  DesktopHostProps,
  DesktopPanelKind,
} from "../types";
import { routeDialogs } from "./routes/dialogs";
import { routePanels } from "./routes/panels";
import { routeSession } from "./routes/session";
import { routeStream } from "./routes/stream";
import type { MessageRouteContext } from "./routes/context";

/**
 * Refs the message router reads at event time. Structurally typed so the
 * module never imports components (muse/ must not depend on components/):
 * MessageInputHandle only contributes `focus`, MessageList only
 * `scrollToBottom`.
 */
export interface MessageRouterRefs {
  paneIdRef: React.MutableRefObject<string | undefined>;
  stateRef: React.MutableRefObject<ChatState>;
  messageListRef: React.RefObject<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>;
  messageInputRef: React.RefObject<{ focus: () => void }>;
  chatContainerRef: React.RefObject<HTMLDivElement>;
  togglePanelRef: React.MutableRefObject<(kind: DesktopPanelKind) => void>;
  previewUrlRef: React.MutableRefObject<string | null>;
  groupKeyRef: React.MutableRefObject<string | undefined>;
  previewGroupKeyRef: React.MutableRefObject<string | undefined>;
  fileContentGroupKeyRef?: React.MutableRefObject<string | undefined>;
  openQuickOpenRef: React.MutableRefObject<(query: string) => void>;
  hostRef: React.MutableRefObject<DesktopHostProps | undefined>;
}

export interface MessageHandlerDeps {
  dispatch: React.Dispatch<ChatAction>;
  vscode: VsCodeApi;
  refs: MessageRouterRefs;
}

/**
 * Factory for the window "message" listener that turns host pushes into
 * reducer actions / store patches. Command bodies live in `routes/` and keep
 * the original switch semantics (`break` still ends the command). `myPane`
 * is snapshotted once at factory creation; paneId never changes for a
 * mounted ChatApp, so this equals the old effect-time capture.
 */
export function createMessageHandler({
  dispatch,
  vscode,
  refs,
}: MessageHandlerDeps): (event: MessageEvent) => void {
  const {
    paneIdRef,
    stateRef,
    messageListRef,
    messageInputRef,
    chatContainerRef,
    togglePanelRef,
    previewUrlRef,
    groupKeyRef,
    previewGroupKeyRef,
    fileContentGroupKeyRef,
    openQuickOpenRef,
    hostRef,
  } = refs;

  // Session-scoped host pushes are pane-tagged on desktop (FR-032). This pane
  // consumes a message when it is untagged (single view / global commands) or
  // tagged with this pane's id. Messages tagged with a different paneId
  // belong to a sibling pane and are ignored here.
  const myPane = paneIdRef.current;
  const forThisPane = (message: { paneId?: string }): boolean =>
    myPane === undefined || message.paneId === myPane;

  const ctx: MessageRouteContext = {
    dispatch,
    vscode,
    myPane,
    forThisPane,
    paneIdRef,
    stateRef,
    messageListRef,
    messageInputRef,
    chatContainerRef,
    togglePanelRef,
    previewUrlRef,
    groupKeyRef,
    previewGroupKeyRef,
    fileContentGroupKeyRef,
    openQuickOpenRef,
    hostRef,
  };

  return (event: MessageEvent) => {
    const message = event.data;
    if (routeStream(message, ctx)) return;
    if (routeSession(message, ctx)) return;
    if (routePanels(message, ctx)) return;
    routeDialogs(message, ctx);
  };
}
