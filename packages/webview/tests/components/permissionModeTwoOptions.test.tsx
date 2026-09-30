/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderDraftChatApp, fireEvent, act, sendCommand } from "../webview/test-utils";

describe("Permission Mode panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes a full-access toggle instead of plan/default list options", async () => {
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
    expect(select).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(select);
    });

    expect(
      document.querySelector('[data-testid="permission-full-access-toggle"]'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-value="plan"]')).toBeNull();
    expect(document.querySelector('[data-value="default"]')).toBeNull();
    expect(document.querySelectorAll(".permission-mode-item")).toHaveLength(0);
  });
});
