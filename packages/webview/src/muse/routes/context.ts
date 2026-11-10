import type React from "react";
import type { ChatAction, ChatState, DesktopHostProps, DesktopPanelKind, VsCodeApi } from "../../types";

/** Closed-over bindings from createMessageHandler. Route modules read these at event time. */
export interface MessageRouteContext {
  dispatch: React.Dispatch<ChatAction>;
  vscode: VsCodeApi;
  myPane: string | undefined;
  forThisPane: (message: { paneId?: string }) => boolean;
  paneIdRef: React.MutableRefObject<string | undefined>;
  stateRef: React.MutableRefObject<ChatState>;
  messageListRef: React.RefObject<{ scrollToBottom: (behavior?: ScrollBehavior) => void }>;
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
