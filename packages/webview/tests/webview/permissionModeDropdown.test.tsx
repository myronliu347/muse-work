/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderDraftChatApp,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

describe("Permission Mode Select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles full access from the permission panel", async () => {
    const { vscode } = renderDraftChatApp();

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
    expect(select).toHaveTextContent("默认权限");

    vscode.postMessage.mockClear();

    await act(async () => {
      fireEvent.click(select);
    });
    expect(
      document.querySelector('[data-testid="permission-mode-panel"]'),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        document.querySelector(
          '[data-testid="permission-full-access-toggle"]',
        ) as HTMLElement,
      );
    });

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "setPermissionMode",
        mode: "bypassPermissions",
      });
    });
  });

  it("shows sandbox copy and the full-access toggle", async () => {
    renderDraftChatApp();

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
    await act(async () => {
      fireEvent.click(select);
    });

    const panel = document.querySelector(
      '[data-testid="permission-mode-panel"]',
    );
    expect(panel).toHaveTextContent("当前为默认权限");
    expect(panel).toHaveTextContent("允许完全访问");
    expect(
      document.querySelector('[data-testid="permission-full-access-toggle"]'),
    ).toBeInTheDocument();
  });
});
