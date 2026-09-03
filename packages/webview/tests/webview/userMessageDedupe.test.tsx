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

  it("does not duplicate when user:message lands before the optimistic bubble", async () => {
    renderChatApp();

    sendCommand("user:message", { id: "msg-real-uuid", content: "了解 nasl" });
    sendCommand("appendMessage", {
      message: {
        id: "user_opt_late",
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", content: "了解 nasl" }],
      },
    });

    await waitFor(() => {
      expect(getMessages()).toHaveLength(1);
    });
    expect(getMessageIds()).toEqual(["msg-real-uuid"]);
  });

  it("dedupes against the optimistic bubble even when an error block lands between", async () => {
    renderChatApp();

    // Optimistic bubble appended by the host when the user sends.
    sendCommand("appendMessage", {
      message: {
        id: "user_opt_456",
        role: "user",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "text", content: "hello" }],
      },
    });

    // A bogus empty-turn error block is broadcast before the user:message echo
    // (server-side queued-send race), pushing the optimistic bubble off the tail.
    sendCommand("updateErrorBlock", { error: "模型没有产生输出" });

    // The user:message echo arrives after the error block; the dedupe must skip
    // the interleaved block and still reconcile against the optimistic bubble.
    sendCommand("user:message", { id: "msg-real-uuid", content: "hello" });

    await waitFor(() => {
      expect(getMessageIds()).toEqual(["msg-real-uuid", expect.anything()]);
    });
    const texts = getMessages().map((m) => m.textContent ?? "");
    expect(texts.filter((t) => t.includes("hello"))).toHaveLength(1);
    // The empty-turn error block is still shown as its own entry.
    expect(texts.some((t) => t.includes("模型没有产生输出"))).toBe(true);
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

  it("dedupes a late echo (>5s) against the optimistic bubble (queued-send slow turn)", async () => {
    // Regression: when the SDK actually queues the send behind a long-running
    // turn, the user:message echo only arrives after that turn settles — which
    // can be well beyond the 5s recency window. The optimistic bubble is then
    // older than the window, so a recency-based dedupe appends a second copy.
    renderChatApp();

    // Optimistic bubble appended at send time (60s ago, i.e. past the window).
    const oldTs = new Date(Date.now() - 60_000).toISOString();
    sendCommand("appendMessage", {
      message: {
        id: "user_opt_late",
        role: "user",
        timestamp: oldTs,
        blocks: [{ type: "text", content: "queued hello" }],
      },
    });

    // The echo finally arrives long after the bubble was created.
    sendCommand("user:message", {
      id: "msg-real-uuid",
      content: "queued hello",
    });

    await waitFor(() => {
      expect(getMessages()).toHaveLength(1);
    });
    expect(getMessageIds()[0]).toBe("msg-real-uuid");
  });
});
