/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "../webview/test-utils";

describe("Permission Mode two options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only acceptEdits and bypassPermissions in the dropdown", async () => {
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
    expect(select).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(select);
    });

    const options = Array.from(
      document.querySelectorAll(".permission-mode-item"),
    );
    const optionValues = options.map((o) => o.getAttribute("data-value"));
    expect(options).toHaveLength(2);
    expect(optionValues).toEqual(["acceptEdits", "bypassPermissions"]);
    expect(document.querySelector('[data-value="plan"]')).toBeNull();
    expect(document.querySelector('[data-value="default"]')).toBeNull();
  });
});
