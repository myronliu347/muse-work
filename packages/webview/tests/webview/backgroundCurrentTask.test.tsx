import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  sendCommand,
  act,
} from "./test-utils";

/**
 * Composer Ctrl+B / ⌘B used to post `backgroundCurrentTask`. That shortcut is
 * gone: a follow-up message backgrounds a running subagent instead, and idle
 * Ctrl+B stays with the host (sidebar toggle).
 */
describe("Composer Ctrl+B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not post backgroundCurrentTask on Ctrl+B while streaming", async () => {
    const { vscode } = renderChatApp();

    sendCommand("startStreaming");

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "b", ctrlKey: true });
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "backgroundCurrentTask",
    });
  });

  it("does not post backgroundCurrentTask on Cmd+B while streaming", async () => {
    const { vscode } = renderChatApp();

    sendCommand("startStreaming");

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "b", metaKey: true });
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "backgroundCurrentTask",
    });
  });
});
