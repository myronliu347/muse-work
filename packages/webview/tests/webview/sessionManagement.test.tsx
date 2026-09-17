import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import {
  renderChatApp,
  screen,
  act,
  sendCommand,
  sendHostMessage,
  setInputText,
  fireInput,
  waitFor,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import { MockDataGenerator } from "../fixtures/mockData";

describe("Session Management", () => {
  it("should keep the new session button enabled during streaming", () => {
    renderChatApp();

    const sessions = [
      {
        id: "session-1",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "A session",
        lastActiveAt: new Date("2023-12-01T10:00:00Z"),
        latestTotalTokens: 150,
      },
    ];

    act(() => {
      sendCommand("updateSessions", { sessions });
      sendCommand("updateCurrentSession", { session: sessions[0] });
    });

    act(() => {
      sendCommand("startStreaming");
    });

    expect(screen.getByTestId("desktop-new-session")).not.toBeDisabled();

    act(() => {
      sendCommand("endStreaming");
    });

    expect(screen.getByTestId("desktop-new-session")).not.toBeDisabled();
  });

  it("should show 新对话 title for a current session that has no first message yet", () => {
    renderChatApp();

    // A freshly created session is pushed as currentSession before any
    // message is sent, so it has no firstMessage.
    act(() => {
      sendCommand("updateCurrentSession", {
        session: {
          id: "fresh-session",
          sessionType: "main",
          workdir: "/test/project",
          lastActiveAt: new Date("2026-07-22T13:46:00Z"),
          latestTotalTokens: 0,
        },
      });
    });

    // Must show the friendly default, not a formatted timestamp
    const header = screen.getByTestId("chat-header");
    expect(header).toHaveTextContent("新对话");
    expect(header).not.toHaveTextContent("2026");
  });

  it("should derive the title from the first user message once one is sent", () => {
    renderChatApp();

    // Fresh session pushed without a firstMessage.
    act(() => {
      sendCommand("updateCurrentSession", {
        session: {
          id: "fresh-session",
          sessionType: "main",
          workdir: "/test/project",
          lastActiveAt: new Date("2026-07-22T13:46:00Z"),
          latestTotalTokens: 0,
        },
      });
    });
    expect(screen.getByTestId("chat-header")).toHaveTextContent("新对话");

    // User sends "hi" — the title should now reflect it.
    act(() => {
      sendHostMessage(
        fixtures.updateMessages([MockDataGenerator.createUserMessage("hi")]),
      );
    });

    const header = screen.getByTestId("chat-header");
    expect(header).toHaveTextContent("hi");
    expect(header).not.toHaveTextContent("新对话");
  });
});

describe("input drafts per session (desktop-app.md 会话管理 scenario 11/12)", () => {
  const sessionA = {
    id: "session-A",
    sessionType: "main" as const,
    workdir: "/test/project",
    firstMessage: "Session A",
    createdAt: new Date("2023-12-01T10:00:00Z"),
    lastActiveAt: new Date("2023-12-01T10:00:00Z"),
    latestTotalTokens: 150,
  };
  const sessionB = {
    id: "session-B",
    sessionType: "main" as const,
    workdir: "/test/project",
    firstMessage: "Session B",
    createdAt: new Date("2023-12-01T11:00:00Z"),
    lastActiveAt: new Date("2023-12-01T11:00:00Z"),
    latestTotalTokens: 250,
  };

  it("switching sessions resets the input even when both drafts are equal (empty)", async () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionA, messages: [] }),
      );
    });
    const input = screen.getByTestId("message-input");

    // Type '1' into A — the 150ms debounced save is still pending.
    await setInputText(input, "1");
    expect(input.innerText).toBe("1");

    // Switch to B, whose draft is also empty — the input must still reset
    // (value equality alone cannot distinguish two empty drafts).
    vscode.postMessage.mockClear();
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionB, messages: [] }),
      );
    });

    expect(input.innerText).toBe("");
    // The outgoing draft is flushed, tagged with A's session so the host
    // saves it to the right conversation.
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        sessionId: "session-A",
        content: "1",
      }),
    );
  });

  it("switching back to a session restores its unsent draft", () => {
    renderChatApp();

    // A has an unsent draft persisted by the host.
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({
          session: sessionA,
          messages: [],
          inputContent: "1",
        }),
      );
    });
    const input = screen.getByTestId("message-input");
    expect(input.innerText).toBe("1");

    // Switch to B (no draft) — the input clears.
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionB, messages: [] }),
      );
    });
    expect(input.innerText).toBe("");

    // Back to A — the draft comes back with the conversation.
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({
          session: sessionA,
          messages: [],
          inputContent: "1",
        }),
      );
    });
    expect(input.innerText).toBe("1");
  });

  it("a pending debounced save is cancelled on session switch — only the tagged flush lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { vscode } = renderChatApp();
      act(() => {
        sendHostMessage(
          fixtures.setInitialState({ session: sessionA, messages: [] }),
        );
      });
      const input = screen.getByTestId("message-input");

      await setInputText(input, "1");
      vscode.postMessage.mockClear();

      // Switch to B: the effect cancels the pending timer and flushes the
      // outgoing draft with A's tag immediately.
      act(() => {
        sendHostMessage(
          fixtures.setInitialState({ session: sessionB, messages: [] }),
        );
      });
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "updateInputContent",
          sessionId: "session-A",
          content: "1",
        }),
      );

      // Advancing past the original debounce must not fire a second save —
      // the stale timer was cancelled by the switch.
      await vi.advanceTimersByTimeAsync(200);
      const updates = vscode.postMessage.mock.calls.filter(
        ([m]) => (m as { command?: string }).command === "updateInputContent",
      );
      expect(updates).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("switching away and back restores the draft kept locally (no host push)", async () => {
    renderChatApp();
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionA, messages: [] }),
      );
    });
    const input = screen.getByTestId("message-input");

    // Type into A, then switch to B before the debounced save fires. The
    // outgoing draft must be kept in the pane so it can come back.
    await setInputText(input, "1");
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionB, messages: [] }),
      );
    });
    expect(input.innerText).toBe("");

    // Back to A with no inputContent from the host (the desktop host never
    // pushes drafts) — the locally kept draft is restored.
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionA, messages: [] }),
      );
    });
    expect(input.innerText).toBe("1");
  });

  it("sending a message clears the draft so it is not restored on return", async () => {
    renderChatApp();
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionA, messages: [] }),
      );
    });
    const input = screen.getByTestId("message-input");

    // textContent + fireInput (not setInputText): setInputText stubs innerText
    // on the element, which would survive handleSend's innerHTML clear and
    // mask the actual DOM state.
    input.textContent = "hello";
    await fireInput(input, { inputType: "insertText" });
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });
    expect(input.innerText).toBe("");

    // Switch away and back — the sent text must not resurface.
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionB, messages: [] }),
      );
    });
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionA, messages: [] }),
      );
    });
    expect(input.innerText).toBe("");
  });
});

describe("pasted images per session", () => {
  const TINY_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

  interface MockDataTransferItem {
    type: string;
    getAsFile: () => File;
  }
  class MockDataTransfer {
    private _files: File[] = [];
    private _items: MockDataTransferItem[] = [];
    get files(): File[] {
      return this._files;
    }
    get items(): MockDataTransferItem[] & {
      add: (file: File) => void;
      length: number;
    } {
      const arr = this._items as MockDataTransferItem[] & {
        add: (file: File) => void;
        length: number;
      };
      arr.add = (file: File) => {
        this._files.push(file);
        this._items.push({ type: file.type, getAsFile: () => file });
      };
      return arr;
    }
    get types(): string[] {
      return [];
    }
    getData() {
      return "";
    }
    setData() {}
    clearData() {}
  }

  function createImagePasteEvent(filename: string): ClipboardEvent {
    const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) =>
      c.charCodeAt(0),
    );
    const file = new File([bytes], filename, { type: "image/png" });
    const dataTransfer = new MockDataTransfer();
    dataTransfer.items.add(file);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: dataTransfer,
      configurable: true,
    });
    return event as ClipboardEvent;
  }

  const sessionA = {
    id: "session-A",
    sessionType: "main" as const,
    workdir: "/test/project",
    firstMessage: "Session A",
    createdAt: new Date("2023-12-01T10:00:00Z"),
    lastActiveAt: new Date("2023-12-01T10:00:00Z"),
    latestTotalTokens: 150,
  };
  const sessionB = {
    id: "session-B",
    sessionType: "main" as const,
    workdir: "/test/project",
    firstMessage: "Session B",
    createdAt: new Date("2023-12-01T11:00:00Z"),
    lastActiveAt: new Date("2023-12-01T11:00:00Z"),
    latestTotalTokens: 250,
  };

  beforeEach(() => {
    (globalThis as Record<string, unknown>).DataTransfer = MockDataTransfer;
  });

  it("switching sessions does not show the previous conversation's unsent images", async () => {
    renderChatApp();
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({ session: sessionA, messages: [] }),
      );
    });
    const input = screen.getByTestId("message-input");
    await act(async () => {
      input.dispatchEvent(createImagePasteEvent("shot.png"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("attached-images")).toBeInTheDocument();
    });

    // Desktop session switch: updateCurrentSession + updateMessages, not
    // setInitialState — attachedImages in ChatState is never rewritten.
    act(() => {
      sendCommand("updateCurrentSession", { session: sessionB });
      sendCommand("updateMessages", { messages: [] });
    });
    expect(screen.queryByTestId("attached-images")).toBeNull();

    act(() => {
      sendCommand("updateCurrentSession", { session: sessionA });
      sendCommand("updateMessages", { messages: [] });
    });
    expect(screen.getByTestId("attached-images")).toBeInTheDocument();
  });
});
