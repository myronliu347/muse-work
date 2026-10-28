import { matchTabStepShortcut } from "./panelShortcuts";

const PANEL_SELECTOR =
  ".desktop-panel-dock, .assistant-split-bot, .assistant-split-issue, .assistant-frame";

const steps = new Map<HTMLElement, (direction: -1 | 1) => void>();
let keyboardPanel: HTMLElement | null = null;
let installed = false;
let lastStep: { at: number; direction: -1 | 1; source: "keydown" | "message" } | null = null;

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
  if (!keyboardPanel) return;
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

function ensureInstalled(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener(
    "keydown",
    (event) => {
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
    if (!data || data.command !== "desktopStepTab") return;
    if (data.direction !== -1 && data.direction !== 1) return;
    stepFocusedPanel(data.direction, "message");
  });
}

export function registerSidePanel(
  panel: HTMLElement,
  step: (direction: -1 | 1) => void,
): () => void {
  ensureInstalled();
  steps.set(panel, step);
  return () => {
    steps.delete(panel);
    if (keyboardPanel === panel) keyboardPanel = null;
  };
}
