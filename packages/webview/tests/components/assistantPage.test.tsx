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
    expect(screen.getAllByText("Muse Bot").length).toBeGreaterThan(1);
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

  it("shows the waiting queue", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
      listAssistantQueue: vi.fn().mockResolvedValue({
        items: [
          { type: "chat", title: "Muse：现在可以关了", active: true },
          { type: "issue", title: "分析 wave-agent", active: true },
          { type: "chat", title: "Muse：稍后" },
        ],
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("Muse：现在可以关了")).toBeTruthy();
    expect(screen.getByText("分析 wave-agent")).toBeTruthy();
    expect(screen.getAllByText("处理中")).toHaveLength(2);
    expect(screen.getByText("等待")).toBeTruthy();
    expect(screen.getByText("Muse：稍后")).toBeTruthy();
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { command: "assistant:queue", items: [] },
      }),
    );
    expect(await screen.findByText("没有等待的事件")).toBeTruthy();
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
    expect(await screen.findByText("Muse Bot")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 消息" }));
    expect(await screen.findByText("工具调用了")).toBeTruthy();
    expect(api.getMessages).toHaveBeenCalledWith("asst");
  });

  it("labels the master's POPO private messages", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: "1", at: 1, role: "user", message: "私聊过来", app: "popo" },
          { id: "2", at: 2, role: "assistant", message: "私聊回去", app: "popo" },
        ],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
    };
    render(<AssistantPage api={api} />);
    expect(await screen.findByText("私聊过来")).toBeTruthy();
    expect(screen.getByText("私聊回去")).toBeTruthy();
    expect(screen.getAllByText("POPO")).toHaveLength(2);
  });

  it("scrolls the chat log to the bottom when switching back from AI messages", async () => {
    const api = {
      listAssistantMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "1", at: 1, role: "user", message: "你好" }],
        hasMore: false,
      }),
      sendAssistantMessage: vi.fn(),
      getAssistantSession: vi.fn().mockResolvedValue({
        sessionId: "asst",
        title: "Muse Bot",
        workdir: "/tmp/assistant-chat",
      }),
      getMessages: vi.fn().mockResolvedValue({ messages: [] }),
    };
    const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as Element).classList?.contains("assistant-log") ? 900 : 0;
      },
    });
    try {
      render(<AssistantPage api={api} />);
      expect(await screen.findByText("你好")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "AI 消息" }));
      expect(document.querySelector(".assistant-log")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "对话" }));
      const log = document.querySelector(".assistant-log") as HTMLDivElement;
      expect(log.scrollTop).toBe(900);
    } finally {
      if (scrollHeight) Object.defineProperty(Element.prototype, "scrollHeight", scrollHeight);
    }
  });
});
