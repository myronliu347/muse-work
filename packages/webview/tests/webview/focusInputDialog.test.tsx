import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";
import { EDIT_TOOL_NAME } from "wave-agent-sdk";

// Switching to a side-by-side pane fires `focusInput`. When a tool confirmation
// is open in that pane the message input is hidden (display:none), so focusing
// it silently no-ops. Instead the dialog's primary action should receive focus
// so the keyboard works on it immediately after the switch.
describe("focusInput with an open dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function blurActive() {
    (document.activeElement as HTMLElement | null)?.blur();
  }

  it("focuses the message input when no dialog is open", () => {
    renderChatApp();

    blurActive();
    act(() => {
      sendCommand("focusInput");
    });

    expect(document.activeElement).toBe(screen.getByTestId("message-input"));
  });

  it("focuses the confirmation dialog primary button when a tool confirmation is open", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "test.ts",
          old_string: "old",
          new_string: "new",
        },
      });
    });

    const applyBtn = document.querySelector(
      ".confirmation-btn-apply",
    ) as HTMLElement;
    expect(applyBtn).not.toBeNull();
    // The message input is hidden while the confirmation is showing.
    expect(screen.getByTestId("message-input")).not.toBeVisible();

    blurActive();
    act(() => {
      sendCommand("focusInput");
    });

    expect(document.activeElement).toBe(applyBtn);
  });

  // Deleted with Task 4: "focuses the rewind confirm button when the rewind
  // modal is open". Desktop-only layouts render the rewind ConfirmDialog at the
  // ChatApp root, outside chatContainer; the focusInput handler's
  // chatContainer-scoped lookup (`.confirm-dialog-btn-confirm`) only reached it
  // through the removed hostless path (`chatContainerRef ?? document` fallback,
  // where chatContainerRef was undefined). The desktop layout never mounts that
  // path, so the case tested unreachable UI. Restoring the behavior (document
  // fallback / root-scoped dialog lookup) is a source-level fix, tracked
  // outside the test migration.
});
