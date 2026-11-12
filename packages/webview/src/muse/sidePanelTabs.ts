import { matchCloseFocusedShortcut, matchTabStepShortcut } from "./panelShortcuts";

const PANEL_SELECTOR = ".desktop-panel-dock, .assistant-frame";

const steps = new Map<HTMLElement, (direction: -1 | 1) => void>();
const closers = new Map<HTMLElement, () => boolean>();
let keyboardPanel: HTMLElement | null = null;
let installed = false;
let lastStep: { at: number; direction: -1 | 1; source: "keydown" | "message" } | null = null;
let lastCloseAt = 0;
let closeWindow: (() => void) | null = null;

/** When ⌘W is not aimed at a side panel, the shell closes the window. */
export function registerUnfocusedClose(close: () => void): () => void {
  closeWindow = close;
  return () => {
    if (closeWindow === close) closeWindow = null;
  };
}

function panelFrom(node: Element | null): HTMLElement | null {
  const panel = node?.closest(PANEL_SELECTOR);
  if (!(panel instanceof HTMLElement) || !steps.has(panel)) return null;
  return panel;
}

/** The side panel that should receive ⌘[ / ⌘]. Clicking its blank area counts, even when DOM focus stays in the chat. */
export function sidePanelForKeyboard(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof Element) {
    const focused = panelFrom(active);
    if (focused) return focused;
  }
  if (keyboardPanel?.isConnected && steps.has(keyboardPanel)) return keyboardPanel;
  return null;
}

function stepFocusedPanel(direction: -1 | 1, source: "keydown" | "message"): boolean {
  const now = Date.now();
  // One physical press reaches the page as a keydown and, from the desktop
  // shell, again as a message. The message can arrive after React has already
  // moved the highlight, which would skip a tab. Drop that echo. A later press
  // is a keydown, so it still moves.
  if (
    source === "message" &&
    lastStep?.source === "keydown" &&
    lastStep.direction === direction &&
    now - lastStep.at < 300
  ) {
    return false;
  }
  const panel = sidePanelForKeyboard();
  const step = panel ? steps.get(panel) : undefined;
  if (!step) return false;
  lastStep = { at: now, direction, source };
  step(direction);
  return true;
}

function onPointerDown(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    keyboardPanel = null;
    return;
  }
  keyboardPanel = panelFrom(target);
  if (!keyboardPanel) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && panelFrom(active)) active.blur();
    return;
  }
  if (
    target.closest(
      "input, textarea, select, button, a, [contenteditable='true'], .xterm, webview",
    )
  ) {
    return;
  }
  if (!keyboardPanel.hasAttribute("tabindex")) keyboardPanel.tabIndex = -1;
  keyboardPanel.focus();
}

/** Close the focused issue tab or dock tab. True when a tab actually closed. */
function closeFocusedPanel(): boolean {
  const panel = sidePanelForKeyboard();
  const close = panel ? closers.get(panel) : undefined;
  return Boolean(close?.());
}

function onCloseChord(): void {
  const now = Date.now();
  // The desktop shell reports ⌘W because the window menu would otherwise close
  // the app. The page may also see the key. One press must close one tab.
  if (now - lastCloseAt < 300) return;
  lastCloseAt = now;
  // A focused side panel only closes its current tab. 详情 and Muse Bot have
  // no close button, so the chord stops there instead of closing the window.
  if (sidePanelForKeyboard()) {
    closeFocusedPanel();
    return;
  }
  closeWindow?.();
}

function ensureInstalled(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener(
    "keydown",
    (event) => {
      if (matchCloseFocusedShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        onCloseChord();
        return;
      }
      const direction = matchTabStepShortcut(event);
      if (direction === null) return;
      if (!stepFocusedPanel(direction, "keydown")) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { command?: string; direction?: unknown } | null;
    if (!data) return;
    if (data.command === "desktopCloseFocused") {
      onCloseChord();
      return;
    }
    if (data.command !== "desktopStepTab") return;
    if (data.direction !== -1 && data.direction !== 1) return;
    stepFocusedPanel(data.direction, "message");
  });
}

export function registerSidePanel(
  panel: HTMLElement,
  step: (direction: -1 | 1) => void,
  close?: () => boolean,
): () => void {
  ensureInstalled();
  steps.set(panel, step);
  if (close) closers.set(panel, close);
  else closers.delete(panel);
  return () => {
    steps.delete(panel);
    closers.delete(panel);
    if (keyboardPanel === panel) keyboardPanel = null;
  };
}
