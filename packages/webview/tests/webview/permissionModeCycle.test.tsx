/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

describe("Permission Mode Cycling via Shift+Tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should cycle acceptEdits <-> bypassPermissions", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "acceptEdits",
        configurationData: {},
      });
    });

    const input = screen.getByTestId("message-input");
    const select = document.querySelector(
      ".permission-mode-select",
    ) as HTMLElement;
    expect(select.className).toContain("mode-acceptEdits");

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    });
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "setPermissionMode",
        mode: "bypassPermissions",
      });
    });
    await act(async () => {
      sendCommand("updatePermissionMode", { mode: "bypassPermissions" });
    });
    expect(select.className).toContain("mode-bypassPermissions");

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    });
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "setPermissionMode",
        mode: "acceptEdits",
      });
    });
    await act(async () => {
      sendCommand("updatePermissionMode", { mode: "acceptEdits" });
    });
    expect(select.className).toContain("mode-acceptEdits");
  });

  it("should update the select visual style when mode changes via extension update", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "acceptEdits",
        configurationData: {},
      });
    });

    const select = document.querySelector(
      ".permission-mode-select",
    ) as HTMLElement;
    expect(select.className).toContain("mode-acceptEdits");

    await act(async () => {
      sendCommand("updatePermissionMode", { mode: "bypassPermissions" });
    });

    expect(select.className).toContain("mode-bypassPermissions");
    expect(select.className).not.toContain("mode-acceptEdits");
  });
});
