import { describe, it, expect, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  sendCommand,
} from "./test-utils";

function getMessages(): HTMLElement[] {
  const container = screen.getByTestId("messages-container");
  return Array.from(container.querySelectorAll(".message"));
}

describe("user:message dedupe with [Image source: ...] markers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dedupes a user:message broadcast against the optimistic bubble even when the content carries an [Image source: ...] marker", async () => {
    renderChatApp();

    // Optimistic bubble appended by the host when the user sends a screenshot.
    sendCommand("appendMessage", {
      message: {
        id: "user-opt",
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [
          { type: "text", content: "see this" },
          {
            type: "image",
            imageUrls: ["data:image/png;base64,abc"],
          },
        ],
      },
    });

    // Server echo of the same message, whose content the server extended with
    // an [Image source: ...] marker pointing at the persisted temp file.
    sendCommand("user:message", {
      content: "see this\n\n[Image source: /tmp/muse-work/uploads/a.png]",
      images: [{ path: "data:image/png;base64,abc", mimeType: "image/png" }],
    });

    await waitFor(() => {
      expect(getMessages()).toHaveLength(1);
    });
    expect(getMessages()[0]).toHaveTextContent("see this");
    expect(getMessages()[0].textContent).not.toContain("Image source");
  });
});
