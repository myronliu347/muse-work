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
    expect(screen.getByText("在")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "继续" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(api.sendAssistantMessage).toHaveBeenCalledWith("继续");
  });
});
