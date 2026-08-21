import { describe, it, expect, beforeEach, vi } from "vitest";
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

function getMessageIds(): string[] {
  return getMessages().map(
    (el) => el.getAttribute("data-message-id") ?? "",
  );
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
      id: "msg-real",
      content: "see this\n\n[Image source: /tmp/muse-work/uploads/a.png]",
      images: [{ path: "data:image/png;base64,abc", mimeType: "image/png" }],
    });

    await waitFor(() => {
      expect(getMessages()).toHaveLength(1);
    });
    expect(getMessages()[0]).toHaveTextContent("see this");
    expect(getMessages()[0].textContent).not.toContain("Image source");
  });

  it("reconciles the optimistic bubble id with the real SDK message id so rewind-by-id works", async () => {
    renderChatApp();

    // Optimistic bubble (client-generated id, e.g. user_1yc9h923).
    sendCommand("appendMessage", {
      message: {
        id: "user_opt_123",
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", content: "hi" }],
      },
    });

    // Server echo carries the SDK's real message id.
    sendCommand("user:message", { id: "msg-real-uuid", content: "hi" });

    await waitFor(() => {
      expect(getMessageIds()).toEqual(["msg-real-uuid"]);
    });
  });

  it("appends queued sends with the real SDK message id (no optimistic bubble existed)", async () => {
    renderChatApp();

    // Queued send while the AI was busy: no optimistic bubble, the echo
    // creates the bubble directly with the real id.
    sendCommand("user:message", { id: "msg-queued-uuid", content: "queued" });

    await waitFor(() => {
      expect(getMessageIds()).toEqual(["msg-queued-uuid"]);
    });
    expect(getMessages()[0]).toHaveTextContent("queued");
  });

  it("keeps a client-generated id when the broadcast carries no id (legacy server)", async () => {
    renderChatApp();

    sendCommand("user:message", { content: "no-id" });

    await waitFor(() => {
      expect(getMessages()).toHaveLength(1);
    });
    const id = getMessageIds()[0];
    expect(id).toMatch(/^user-/);
  });
});
