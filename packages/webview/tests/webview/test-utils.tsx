import React from "react";
import { vi } from "vitest";
import { render, act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VsCodeApi, DesktopHostProps } from "../../src/types";
import { ChatApp } from "../../src/components/ChatApp";
import { DesktopApp } from "../../src/components/DesktopApp";
import { MuseTheme } from "../../src/ui/theme";
import { resetWebviewStores } from "../../src/stores";
import { fixtures, type HostToWebviewMessage } from "wave-webview-fixtures";

// Mock heavy dependencies
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

// Mock CSS imports
vi.mock("../../src/styles/ChatApp.css", () => ({}));
vi.mock("../../src/styles/globals.css", () => ({}));
vi.mock("@vscode/codicons/dist/codicon.css", () => ({}));

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

/**
 * Create a mock VS Code API object
 */
export function createMockVscode() {
  return {
    postMessage: vi.fn(),
    getState: vi.fn().mockReturnValue(null),
    setState: vi.fn(),
  };
}

/**
 * Desktop host props for tests. Mirrors what index.tsx → DesktopApp injects in
 * production (single-pane layout, no split-view panes): ChatApp renders the
 * desktop sidebar + chat chrome. The workdir enables the message input for
 * bound sessions.
 */
export function createMockDesktopHost(
  overrides?: Partial<DesktopHostProps>,
): DesktopHostProps {
  return {
    type: "desktop",
    host: "local",
    workdir: "/mock/workdir",
    recentWorkdirs: [],
    onSelectWorkdir: vi.fn(),
    onSelectRecentWorkdir: vi.fn(),
    onRemoveRecentWorkdir: vi.fn(),
    sessionTree: [],
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onTogglePin: vi.fn(),
    onRenameSession: vi.fn(),
    onOpenPane: vi.fn(),
    panes: [],
    rowHeights: [],
    focusedPaneId: null,
    ...overrides,
  };
}

/** A bound session so isDraftSession is false and chatChrome renders. */
export function establishSession(opts?: {
  workdir?: string;
  sessionId?: string;
  messages?: unknown[];
  inputContent?: string;
  isAuthenticated?: boolean;
}) {
  const workdir = opts?.workdir ?? "/mock/workdir";
  sendHostMessage(
    fixtures.setInitialState({
      workdir,
      messages: opts?.messages ?? [],
      isAuthenticated: opts?.isAuthenticated ?? true,
      session: {
        id: opts?.sessionId ?? "sess-mock",
        sessionType: "main",
        workdir,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
      ...(opts?.inputContent !== undefined
        ? { inputContent: opts.inputContent }
        : {}),
    }),
  );
}

/** Draft / new-session page so the composer footer (workdir + permission) renders. */
export function establishDraftSession(opts?: {
  workdir?: string;
  permissionMode?: "acceptEdits" | "bypassPermissions";
  isAuthenticated?: boolean;
}) {
  sendHostMessage(
    fixtures.setInitialState({
      workdir: opts?.workdir,
      messages: [],
      isAuthenticated: opts?.isAuthenticated ?? true,
      permissionMode: opts?.permissionMode ?? "acceptEdits",
      session: {
        id: "__draft__",
        sessionType: "main",
        workdir: opts?.workdir,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
      },
    }),
  );
}

/**
 * Render the ChatApp with a mock VS Code API on the desktop host. Desktop-only:
 * the extension entry (index.tsx → DesktopApp) always boots the desktop layout,
 * so tests exercise the same environment. A bound session is established so the
 * chat chrome (messages-container, header, input) renders instead of the draft
 * new-session page.
 */
export function renderChatApp(vscode?: VsCodeApi) {
  resetWebviewStores();
  const mockVscode = (vscode || createMockVscode()) as ReturnType<
    typeof createMockVscode
  >;
  const result = render(
    <MuseTheme>
      <ChatApp vscode={mockVscode} host={createMockDesktopHost()} />
    </MuseTheme>,
  );
  // Default to authenticated so the message input is enabled and MessageList
  // (not the unauthenticated WelcomeView) renders for empty-state assertions.
  sendHostMessage(fixtures.authStatusResponse());
  // Bind a session so the draft new-session page is not shown.
  establishSession();
  const user = userEvent.setup();
  return { ...result, vscode: mockVscode, user };
}

/**
 * Same as renderChatApp, but stays on the draft new-session page
 * (composer footer with workdir + permission is visible).
 */
export function renderDraftChatApp(vscode?: VsCodeApi) {
  resetWebviewStores();
  const mockVscode = (vscode || createMockVscode()) as ReturnType<
    typeof createMockVscode
  >;
  const result = render(
    <MuseTheme>
      <ChatApp vscode={mockVscode} host={createMockDesktopHost()} />
    </MuseTheme>,
  );
  sendHostMessage(fixtures.authStatusResponse());
  establishDraftSession();
  const user = userEvent.setup();
  return { ...result, vscode: mockVscode, user };
}

/**
 * Render DesktopApp with MuseTheme and authenticated initial state.
 */
export function renderDesktopApp(vscode?: VsCodeApi) {
  const mockVscode = (vscode || createMockVscode()) as ReturnType<
    typeof createMockVscode
  >;
  const result = render(
    <MuseTheme>
      <DesktopApp vscode={mockVscode} />
    </MuseTheme>,
  );
  return { ...result, vscode: mockVscode };
}

/** Call after desktopWorkdirState so ChatApp (mounted with workdir) receives auth. */
export function bootstrapDesktopAuth(isAuthenticated = true) {
  sendHostMessage(fixtures.authStatusResponse(isAuthenticated));
}

/**
 * Simulate an extension → webview message
 */
export function sendExtensionMessage(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}

/**
 * Simulate extension message with command and additional data
 */
export function sendCommand(command: string, data?: Record<string, unknown>) {
  sendExtensionMessage({ command, ...data });
}

/**
 * Send a typed host → webview message anchored to the shared contract
 * (wave-webview-fixtures). Prefer this over sendCommand for messages that
 * have a fixture, so test payloads stay in lockstep with the real hosts.
 */
export function sendHostMessage(message: HostToWebviewMessage) {
  sendExtensionMessage(message as unknown as Record<string, unknown>);
}

/**
 * Set text on a contenteditable message input, working around jsdom's lack of innerText support.
 * MessageInput reads `event.currentTarget.innerText` in its handleInput handler, but jsdom does
 * not implement the innerText getter/setter. We define it on the element, set textContent, then
 * fire the input event so the React handler picks up the value.
 */
export async function setInputText(element: HTMLElement, text: string) {
  Object.defineProperty(element, "innerText", {
    value: text,
    configurable: true,
    writable: true,
  });
  element.textContent = text;
  await act(async () => {
    fireEvent.input(element, { data: text, inputType: "insertText" });
  });
}

/**
 * Fire an input event wrapped in act() to prevent React state update warnings.
 * If fake timers are enabled, also advances them to flush debounced state updates.
 */
export async function fireInput(
  element: HTMLElement,
  options?: { data?: string; inputType?: string },
) {
  await act(async () => {
    fireEvent.input(element, options);
    // Try to advance timers if fake timers are enabled (flushes 150ms debounce in handleSelectionChange)
    try {
      await vi.advanceTimersByTimeAsync(150);
    } catch {
      // Fake timers not enabled, skip
    }
  });
}

// Re-export the shared fixture factory so tests can build contract-anchored
// host payloads (e.g. subagentConfigurationsResponse).
export { fixtures } from "wave-webview-fixtures";

// Re-export commonly used testing utilities
export {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  act,
} from "@testing-library/react";

/** Scope queries to the message list (avoids duplicate matches in the header). */
export function withinMessages() {
  return within(screen.getByTestId("messages-container"));
}

export type DesktopPanelKind = "preview" | "diff" | "terminal" | "file";

/** Open a desktop panel via keyboard shortcuts (Radix add menu is unreliable in jsdom). */
export function openPanelShortcut(kind: DesktopPanelKind) {
  const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
  if (kind === "terminal") {
    fireEvent.keyDown(window, {
      key: "`",
      code: "Backquote",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      bubbles: true,
    });
    return;
  }
  const key =
    kind === "preview"
      ? "p"
      : kind === "diff"
        ? "d"
        : kind === "file"
          ? "f"
          : null;
  if (!key) throw new Error(`unknown panel kind: ${kind}`);
  fireEvent.keyDown(window, {
    key,
    ctrlKey: !isMac,
    metaKey: isMac,
    shiftKey: true,
    bubbles: true,
  });
}

/** Push the pin/recent session tree groups the sidebar expects. */
export function pushRecentSessionTree(
  sessions: Array<{
    sessionId: string;
    title: string;
    workdir: string;
    lastActiveAt?: number;
    hasWorktree?: boolean;
    running?: boolean;
    waitingConfirmation?: boolean;
  }>,
  pinned: Array<{
    sessionId: string;
    title: string;
    workdir: string;
    lastActiveAt?: number;
    hasWorktree?: boolean;
  }> = [],
) {
  sendHostMessage(
    fixtures.desktopSessionTreeRecent(
      sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        lastActiveAt: s.lastActiveAt ?? Date.now(),
        hasWorktree: s.hasWorktree ?? false,
        workdir: s.workdir,
        ...(s.running !== undefined ? { running: s.running } : {}),
        ...(s.waitingConfirmation !== undefined
          ? { waitingConfirmation: s.waitingConfirmation }
          : {}),
      })),
      pinned.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        lastActiveAt: s.lastActiveAt ?? Date.now(),
        hasWorktree: s.hasWorktree ?? false,
        workdir: s.workdir,
      })),
    ),
  );
}

export { default as userEvent } from "@testing-library/user-event";
