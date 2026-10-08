import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssistantPage } from "../../src/components/assistant/AssistantPage";

describe("AssistantPage", () => {
  it("renders jsonl roles and sends a user line", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "user", message: "你好" },
          { id: "2", at: 2, role: "assistant", message: "在" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn().mockResolvedValue({
        line: { id: "3", at: 3, role: "user", message: "继续" },
      }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("你好")).toBeTruthy();
    expect(screen.getByText("你好").closest(".assistant-bubble-user")).toBeTruthy();
    expect(screen.getByText("在").closest(".assistant-bubble-assistant")).toBeTruthy();
    expect(screen.getAllByText("助理").length).toBeGreaterThan(1);
    expect(document.querySelectorAll(".assistant-bubble-time").length).toBe(2);
    const input = screen.getByTestId("message-input");
    input.textContent = "继续";
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId("send-btn"));
    expect(api.sendAssistantMessage).toHaveBeenCalledWith("继续", undefined);
    expect(await screen.findByTestId("thinking-hint")).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:status", working: false },
      }),
    );
    expect(screen.queryByTestId("thinking-hint")).toBeNull();
  });

  it("renders assistant messages as markdown", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "assistant", message: "- 读代码\n- 改代码" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    const item = await screen.findByText("读代码");
    expect(item.closest("li")).toBeTruthy();
    expect(screen.getByText("改代码").closest("ul")).toBeTruthy();
  });

  it("switches to the assistant session transcript", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        title: "助理",
        workdir: "/tmp/assistant-chat",
      }),
      getMessages: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m1",
            role: "assistant",
            timestamp: "2026-10-08T00:00:00.000Z",
            blocks: [{ type: "text", content: "工具调用了" }],
          },
        ],
      }),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("助理")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 消息" }));
    expect(await screen.findByText("工具调用了")).toBeTruthy();
    expect(api.getMessages).toHaveBeenCalledWith("asst");
  });
});
