import { renderChatApp, screen } from "./test-utils";
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

  it("does not render the removed desktop-only local file pick button in IDE hosts", () => {
    renderChatApp();

    expect(screen.queryByTestId("add-local-file-btn")).not.toBeInTheDocument();
  });
});
