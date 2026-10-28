/** Same channel as workdirHost TO_WEBVIEW. Kept here so window setup does not import the IPC host. */
export const TAB_STEP_CHANNEL = "muse:to-webview";

export interface TabStepInput {
  type: string;
  key: string;
  code: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * macOS delivers ⌘[ / ⌘] to Chromium as history back/forward, so the page
 * often never sees the keydown. The main process reports the chord instead.
 */
export function tabStepDirection(
  input: TabStepInput,
  platform: NodeJS.Platform = process.platform,
): -1 | 1 | null {
  if (input.type !== "keyDown") return null;
  if (input.alt || input.shift) return null;
  const prev = input.key === "[" || input.code === "BracketLeft";
  const next = input.key === "]" || input.code === "BracketRight";
  if (!prev && !next) return null;
  const primary = platform === "darwin" ? input.meta : input.control;
  const secondary = platform === "darwin" ? input.control : input.meta;
  if (!primary || secondary) return null;
  return prev ? -1 : 1;
}

export function attachTabStepShortcut(
  contents: {
    on: (
      event: "before-input-event",
      listener: (
        event: { preventDefault: () => void },
        input: TabStepInput,
      ) => void,
    ) => void;
  },
  send: (direction: -1 | 1) => void,
): void {
  contents.on("before-input-event", (event, input) => {
    const direction = tabStepDirection(input);
    if (direction === null) return;
    event.preventDefault();
    send(direction);
  });
}
