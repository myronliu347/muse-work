import { describe, it, expect, beforeEach } from "vitest";
import { renderChatApp, screen, fireEvent, sendCommand } from "./test-utils";

/**
 * Helper: get all message elements from the messages container
 */
function getMessages(): HTMLElement[] {
  const container = screen.getByTestId("messages-container");
  return Array.from(container.querySelectorAll(".message"));
}

describe("Streaming Button States", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should swap send for abort during streaming while new session stays enabled", () => {
    renderChatApp();

    const newSessionBtn = screen.getByTestId("desktop-new-session");
    expect(newSessionBtn).not.toBeDisabled();
    expect(screen.getByTestId("send-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("abort-btn")).not.toBeInTheDocument();

    sendCommand("startStreaming");

    expect(newSessionBtn).not.toBeDisabled();
    expect(screen.getByTestId("abort-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("send-btn")).not.toBeInTheDocument();

    const input = screen.getByTestId("message-input");
    expect(input).not.toHaveAttribute("contenteditable", "false");
  });

  it("should restore send button after streaming ends", () => {
    renderChatApp();

    sendCommand("startStreaming");
    const newSessionBtn = screen.getByTestId("desktop-new-session");
    expect(newSessionBtn).not.toBeDisabled();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_streaming_end_1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "Streaming completed" }],
        },
      ],
    });

    sendCommand("endStreaming");

    expect(newSessionBtn).not.toBeDisabled();
    expect(screen.queryByTestId("abort-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("send-btn")).toBeInTheDocument();

    const input = screen.getByTestId("message-input");
    expect(input.textContent).toBe("");
  });

  it("should keep new session button enabled during streaming without clearing messages on click", () => {
    const { vscode } = renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_streaming_prevent_1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "This is a test message" }],
        },
      ],
    });
    expect(getMessages()).toHaveLength(1);

    sendCommand("startStreaming");

    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_streaming_prevent_1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "This is a test message" }],
        },
        {
          id: "msg_streaming_prevent_2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "I'm currently streaming..." }],
        },
      ],
    });
    expect(screen.getByTestId("abort-btn")).toBeInTheDocument();

    vscode.postMessage.mockClear();

    const newSessionBtn = screen.getByTestId("desktop-new-session");
    expect(newSessionBtn).not.toBeDisabled();
    fireEvent.click(newSessionBtn);

    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    // Desktop semantics: the sidebar 新对话 spawns a fresh host session and
    // shows the draft page. It does not clear the previous transcript in place.
    expect(
      sentMessages.filter(
        (msg: Record<string, unknown>) => msg.command === "newSession",
      ),
    ).toHaveLength(1);
    expect(
      sentMessages.filter(
        (msg: Record<string, unknown>) => msg.command === "clearChat",
      ),
    ).toHaveLength(0);
    expect(
      sentMessages.filter(
        (msg: Record<string, unknown>) => msg.command === "newChatTab",
      ),
    ).toHaveLength(0);

    expect(screen.getByTestId("new-session-page")).toBeInTheDocument();
    expect(screen.queryByTestId("messages-container")).toBeNull();
  });

  it("should handle abort and restore button states", () => {
    renderChatApp();

    sendCommand("startStreaming");
    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg_streaming_abort_1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "This will be aborted..." }],
        },
      ],
    });

    const newSessionBtn = screen.getByTestId("desktop-new-session");
    expect(newSessionBtn).not.toBeDisabled();
    expect(screen.getByTestId("abort-btn")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("abort-btn"));

    sendCommand("endStreaming");

    expect(newSessionBtn).not.toBeDisabled();
    expect(screen.queryByTestId("abort-btn")).not.toBeInTheDocument();

    const input = screen.getByTestId("message-input");
    expect(input.textContent).toBe("");
  });
});
