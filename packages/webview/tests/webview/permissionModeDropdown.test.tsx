/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

describe("Permission Mode Select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should select a different mode and update the UI", async () => {
    const { vscode } = renderChatApp();

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
    expect(select).toBeInTheDocument();
    expect(select.className).toContain("mode-acceptEdits");

    vscode.postMessage.mockClear();

    await act(async () => {
      fireEvent.click(select);
    });
    await act(async () => {
      fireEvent.click(
        document.querySelector(
          '.permission-mode-item[data-value="bypassPermissions"]',
        ) as HTMLElement,
      );
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
  });

  it("should include only acceptEdits and bypassPermissions", async () => {
    const { vscode } = renderChatApp();

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
    expect(select).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(select);
    });

    const options = Array.from(
      document.querySelectorAll(".permission-mode-item"),
    );
    const optionValues = options.map((o) => o.getAttribute("data-value"));
    expect(optionValues).toEqual(["acceptEdits", "bypassPermissions"]);

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(
        document.querySelector(
          '.permission-mode-item[data-value="bypassPermissions"]',
        ) as HTMLElement,
      );
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
  });

  it("should switch back to acceptEdits from bypassPermissions", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "bypassPermissions",
        configurationData: {},
      });
    });

    const select = document.querySelector(
      ".permission-mode-select",
    ) as HTMLElement;
    expect(select.className).toContain("mode-bypassPermissions");

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(select);
    });
    await act(async () => {
      fireEvent.click(
        document.querySelector(
          '.permission-mode-item[data-value="acceptEdits"]',
        ) as HTMLElement,
      );
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
});
