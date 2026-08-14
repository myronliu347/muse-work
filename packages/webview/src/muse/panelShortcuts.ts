import type { DesktopPanelKind } from "../types";

const isMac =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform);

/**
 * Map a keydown to a desktop panel toggle, matching PanelToggleMenu labels:
 * - Preview: ⇧⌘P / Ctrl+Shift+P
 * - Diff: ⇧⌘D / Ctrl+Shift+D
 * - Terminal: ⌃` / Ctrl+`
 * - File: ⇧⌘F / Ctrl+Shift+F
 */
export function matchPanelShortcut(event: KeyboardEvent): DesktopPanelKind | null {
  if (event.altKey || event.isComposing) return null;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const code = event.code;

  if (isMac) {
    // Terminal: Control+Backtick (not Command)
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (key === "`" || code === "Backquote")
    ) {
      return "terminal";
    }
    if (event.metaKey && event.shiftKey && !event.ctrlKey) {
      if (key === "p") return "preview";
      if (key === "d") return "diff";
      if (key === "f") return "file";
    }
    return null;
  }

  if (event.ctrlKey && !event.metaKey) {
    if (
      !event.shiftKey &&
      (key === "`" || code === "Backquote")
    ) {
      return "terminal";
    }
    if (event.shiftKey) {
      if (key === "p") return "preview";
      if (key === "d") return "diff";
      if (key === "f") return "file";
    }
  }
  return null;
}

export function matchNewSessionShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey || event.isComposing) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key !== "n") return false;
  if (isMac) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}

export function panelShortcutLabel(kind: DesktopPanelKind): string {
  if (isMac) {
    switch (kind) {
      case "preview":
        return "⇧⌘P";
      case "diff":
        return "⇧⌘D";
      case "terminal":
        return "⌃`";
      case "file":
        return "⇧⌘F";
    }
  }
  switch (kind) {
    case "preview":
      return "Ctrl+Shift+P";
    case "diff":
      return "Ctrl+Shift+D";
    case "terminal":
      return "Ctrl+`";
    case "file":
      return "Ctrl+Shift+F";
  }
}
