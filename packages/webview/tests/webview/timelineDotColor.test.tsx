import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";

function getLastMessage(): HTMLElement {
  const container = document.querySelector(
    '[data-testid="messages-container"]',
  )!;
  const msgs = Array.from(container.querySelectorAll(".message"));
  return msgs[msgs.length - 1] as HTMLElement;
}

describe("timeline dot color by stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text block dot is yellow while streaming and green when done", () => {
    renderChatApp();

    // streaming text → yellow dot
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hello", stage: "streaming" }],
        },
      ],
    });
    const streamingRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(streamingRow.style.getPropertyValue("--dot-color")).toBe(
      "var(--amber-11)",
    );

    // finished text → green dot
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hello", stage: "end" }],
        },
      ],
    });
    const doneRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(doneRow.style.getPropertyValue("--dot-color")).toBe(
      "var(--green-11)",
    );
  });

  it("reasoning block dot is yellow while streaming and green when done", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [
            { type: "reasoning", content: "thinking", stage: "streaming" },
          ],
        },
      ],
    });
    const streamingRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(streamingRow.style.getPropertyValue("--dot-color")).toBe(
      "var(--amber-11)",
    );

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "reasoning", content: "thinking", stage: "end" }],
        },
      ],
    });
    const doneRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(doneRow.style.getPropertyValue("--dot-color")).toBe(
      "var(--green-11)",
    );
  });

  it("history text block without stage defaults to green dot", () => {
    renderChatApp();

    // A loaded-from-history text block has no stage → treated as done (green).
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m3",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "past message" }],
        },
      ],
    });
    const row = getLastMessage().querySelector(".timeline-row") as HTMLElement;
    expect(row.style.getPropertyValue("--dot-color")).toBe("var(--green-11)");
  });
});
