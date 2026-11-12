/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DesktopSidebar } from "../../src/components/desktop/DesktopSidebar";
import { DesktopUpdateChrome } from "../../src/components/desktop/DesktopUpdateChrome";
import { resetDesktopUpdateStatusForTests } from "../../src/desktop/updateStatus";

const postMessage = vi.fn();

afterEach(() => {
  cleanup();
  resetDesktopUpdateStatusForTests();
  postMessage.mockClear();
  delete (window as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
});

function renderChrome() {
  render(<DesktopUpdateChrome />);
}

function renderSidebar() {
  const noop = () => {};
  render(
    <DesktopSidebar
      onNewSession={noop}
      onNewSessionInPane={noop}
      isStreaming={false}
      disabled={false}
      onOpenSettings={noop}
      sessionTree={[]}
      pinnedSessions={[]}
      recentSessions={[]}
      onSelectSession={noop}
      onOpenPane={noop}
      onDeleteSession={noop}
      onTogglePin={noop}
    />,
  );
}

function publish(status: unknown) {
  fireEvent(window, new MessageEvent("message", { data: status }));
}

describe("desktop update button", () => {
  it("shows the polled update on the sidebar and opens the dialog from there", () => {
    window.acquireVsCodeApi = () => ({
      postMessage,
      getState: () => null,
      setState: () => {},
    });
    renderSidebar();
    expect(screen.queryByTestId("desktop-update-btn")).toBeNull();

    publish({
      command: "desktopUpdateStatus",
      phase: "available",
      offer: { kind: "installer", version: "0.2.0" },
    });

    expect(
      screen.getByTestId("desktop-update-btn").getAttribute("aria-label"),
    ).toBe("更新 0.2.0");
    fireEvent.click(screen.getByTestId("desktop-update-btn"));
    expect(postMessage).toHaveBeenCalledWith({ command: "desktopApplyUpdate" });
  });

  it("shows a loading state in settings while a manual check is in flight", () => {
    window.acquireVsCodeApi = () => ({
      postMessage,
      getState: () => null,
      setState: () => {},
    });
    renderChrome();
    fireEvent.click(screen.getByTestId("check-for-update-btn"));
    expect(screen.getByTestId("update-status-text").textContent).toBe("正在检查…");
    expect(screen.queryByTestId("desktop-update-btn")).toBeNull();
  });

  it("checks from the settings header control", () => {
    window.acquireVsCodeApi = () => ({
      postMessage,
      getState: () => null,
      setState: () => {},
    });
    renderChrome();
    fireEvent.click(screen.getByTestId("check-for-update-btn"));
    expect(postMessage).toHaveBeenCalledWith({ command: "desktopCheckForUpdate" });
  });
});
