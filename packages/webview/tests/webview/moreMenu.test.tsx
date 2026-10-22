import { describe, it, expect } from "vitest";
import { renderChatApp, screen, fireEvent, act, sendCommand } from "./test-utils";

/**
 * Desktop icon rail opens settings as a page. The non-desktop more menu still
 * opens ConfigDialog as a dialog (layout defaults to "dialog").
 */
describe("Desktop settings entry", () => {
  it("opens the settings page from the icon rail without a dialog", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("desktop-settings-btn"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getConfiguration" }),
    );
    const page = screen.getByTestId("desktop-settings-page");
    expect(page).toHaveTextContent("外观");
    expect(page).not.toHaveAttribute("role", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".configuration-dialog-overlay")).toBeNull();
    expect(screen.queryByTestId("config-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-panel-dock")).not.toBeInTheDocument();
  });

  it("shows a login button at the top of the settings page when unauthenticated", () => {
    renderChatApp();
    act(() => {
      sendCommand("authStatusResponse", { isAuthenticated: false });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("desktop-settings-btn"));
    });

    const page = screen.getByTestId("desktop-settings-page");
    const login = screen.getByTestId("desktop-login-btn");
    expect(page.contains(login)).toBe(true);
    expect(screen.queryByTestId("desktop-logout-btn")).not.toBeInTheDocument();
  });

  it("posts login when the settings page login button is clicked", () => {
    const { vscode } = renderChatApp();
    act(() => {
      sendCommand("authStatusResponse", { isAuthenticated: false });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("desktop-settings-btn"));
    });
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(screen.getByTestId("desktop-login-btn"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "login" }),
    );
  });

  it("hides the login button on the settings page when authenticated", () => {
    renderChatApp();
    act(() => {
      fireEvent.click(screen.getByTestId("desktop-settings-btn"));
    });

    expect(screen.getByTestId("desktop-settings-page")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-login-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desktop-logout-btn")).not.toBeInTheDocument();
  });
});
