import { renderChatApp, screen, fireEvent, act } from "./test-utils";
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Input toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the permission mode selector and send button in the toolbar", () => {
    renderChatApp();

    expect(screen.getByLabelText("权限模式")).toBeInTheDocument();
    expect(screen.getByTestId("send-btn")).toHaveAttribute("aria-label", "发送");
  });

  it("renders the desktop local file pick button and posts desktopSelectFiles on click", () => {
    const { vscode } = renderChatApp();

    // Desktop-only: local file pick is always enabled, so the 添加文件 button
    // is part of the toolbar.
    const fileBtn = screen.getByTestId("add-local-file-btn");
    expect(fileBtn).toHaveAttribute("aria-label", "添加文件");

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(fileBtn);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "desktopSelectFiles" }),
    );
  });
});
