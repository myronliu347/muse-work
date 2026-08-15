import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderChatApp, screen, sendCommand, waitFor, act } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * Timeline vertical-line grouping (设计稿: assistant 时间线竖线跨消息贯穿).
 *
 * MessageList groups consecutive role==='assistant' messages into a single
 * `.assistant-group` wrapper so the timeline line runs continuously through all
 * their dots. User messages break the timeline. Completed assistant runs may
 * collapse into a work summary + final bubble.
 */
describe("Timeline assistant grouping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getContainer() {
    return screen.getByTestId("messages-container");
  }

  async function loadMessages(messages: ReturnType<typeof MockDataGenerator.createAssistantMessage>[]) {
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() => {
      expect(screen.getByTestId("messages-container")).toBeInTheDocument();
    });
    return getContainer();
  }

  it("groups consecutive assistant messages and isolates the post-user one", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessage("first assistant", "a1"),
      MockDataGenerator.createAssistantMessage("second assistant", "a2"),
      MockDataGenerator.createUserMessage("a user question", "u1"),
      MockDataGenerator.createAssistantMessage("third assistant", "a3"),
    ];
    const container = await loadMessages(messages);
    const groups = container.querySelectorAll(".assistant-group");

    expect(groups.length).toBe(2);

    const firstGroup = groups[0];
    expect(
      firstGroup.querySelector('[data-testid="assistant-group-collapsed"]') ??
        firstGroup.querySelectorAll(".message.assistant").length,
    ).toBeTruthy();
    expect(firstGroup.querySelectorAll(".message.assistant").length).toBeGreaterThanOrEqual(1);

    const secondGroup = groups[1];
    expect(secondGroup.querySelectorAll(".message.assistant").length).toBe(1);
    expect(secondGroup.classList.contains("assistant-group--single")).toBe(true);
  });

  it("does not wrap the user message inside any assistant-group", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createAssistantMessage("first assistant", "a1"),
      MockDataGenerator.createAssistantMessage("second assistant", "a2"),
      MockDataGenerator.createUserMessage("a user question", "u1"),
      MockDataGenerator.createAssistantMessage("third assistant", "a3"),
    ];
    const container = await loadMessages(messages);
    const userMessage = container.querySelector('[data-role="user"]');
    expect(userMessage).not.toBeNull();
    expect(userMessage?.closest(".assistant-group")).toBeNull();
  });
});
