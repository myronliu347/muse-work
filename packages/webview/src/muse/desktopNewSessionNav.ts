type OpenDesktopNewSession = () => void;

let openDesktopNewSession: OpenDesktopNewSession | null = null;

const PANE_NEW_SESSION_EVENT = "muse-desktop-new-session";

/**
 * The visible desktop shell registers this: DesktopShell when panes exist,
 * otherwise the no-pane rail in ChatApp. Cmd+N is a window menu accelerator,
 * so the shell has to switch to 会话 itself.
 */
export function registerDesktopNewSessionOpener(
  open: OpenDesktopNewSession,
): () => void {
  openDesktopNewSession = open;
  return () => {
    if (openDesktopNewSession === open) openDesktopNewSession = null;
  };
}

/** Switch to 会话 and start a draft. False when no desktop shell is mounted. */
export function openDesktopNewSessionPage(): boolean {
  if (!openDesktopNewSession) return false;
  openDesktopNewSession();
  return true;
}

/** Tell the focused pane to show the draft in the same turn as the shell switch. */
export function notifyFocusedPaneNewSession(): void {
  window.dispatchEvent(new Event(PANE_NEW_SESSION_EVENT));
}

export function subscribeFocusedPaneNewSession(
  listener: () => void,
): () => void {
  window.addEventListener(PANE_NEW_SESSION_EVENT, listener);
  return () => window.removeEventListener(PANE_NEW_SESSION_EVENT, listener);
}
