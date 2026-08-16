import { describe, it, expect } from "vitest";
import { renderChatApp, screen, fireEvent, act } from "./test-utils";

/**
 * Desktop-only: the chat-header more menu (more-btn / MoreMenu) is hidden —
 * ChatHeader renders with hideMoreButton. Settings move to the desktop sidebar
 * footer (desktop-settings-btn), which opens the config dialog and requests the
 * provider configuration. The old header-more-menu cases (logout/login entries,
 * Escape close) were deleted with the menu itself in Task 4.
 */
describe("Desktop settings entry", () => {
  it("opens the config dialog and requests configuration from the sidebar 设置 button", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("desktop-settings-btn"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getConfiguration" }),
    );
    expect(screen.getByTestId("config-dialog")).toBeInTheDocument();
  });

  it("closes the config dialog on 关闭", () => {
    renderChatApp();

    act(() => {
      fireEvent.click(screen.getByTestId("desktop-settings-btn"));
    });
    expect(screen.getByTestId("config-dialog")).toBeInTheDocument();

    act(() => {
      const closeBtn = document.querySelector(
        ".configuration-dialog .configuration-close-btn",
      ) as HTMLElement;
      fireEvent.click(closeBtn);
    });
    expect(screen.queryByTestId("config-dialog")).not.toBeInTheDocument();
  });
});
