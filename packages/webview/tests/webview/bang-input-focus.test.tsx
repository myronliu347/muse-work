import { describe, it, expect } from "vitest";
import { renderChatApp, screen, act } from "./test-utils";

describe("Input Focus", () => {
  it("input should remain focused when sending normal message", async () => {
    renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();
    expect(document.activeElement).toBe(input);

    // Simulate streaming starting (normal message)
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "startStreaming" },
        }),
      );
    });

    // Input should still be enabled (not disabled by streaming)
    expect(input).not.toBeDisabled();
  });
});
