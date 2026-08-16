import { describe, it, expect, vi } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  sendCommand,
  sendHostMessage,
  setInputText,
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

    expect(screen.getByTestId("new-session-btn")).not.toBeDisabled();

    act(() => {
      sendCommand("endStreaming");
    });

    expect(screen.getByTestId("new-session-btn")).not.toBeDisabled();
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
});
