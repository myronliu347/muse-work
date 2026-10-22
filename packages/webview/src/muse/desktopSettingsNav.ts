type OpenDesktopSettings = () => void;

let openDesktopSettings: OpenDesktopSettings | null = null;

/**
 * The visible desktop shell registers this: DesktopShell when panes exist,
 * otherwise the no-pane rail in ChatApp.
 */
export function registerDesktopSettingsOpener(
  open: OpenDesktopSettings,
): () => void {
  openDesktopSettings = open;
  return () => {
    if (openDesktopSettings === open) openDesktopSettings = null;
  };
}

/** Switch to the desktop settings page. False when no desktop shell is mounted. */
export function openDesktopSettingsPage(): boolean {
  if (!openDesktopSettings) return false;
  openDesktopSettings();
  return true;
}
