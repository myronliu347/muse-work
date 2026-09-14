/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DesktopSidebar } from "../../src/components/desktop/DesktopSidebar";
import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
} from "../../src/muse/layout";
import {
  getDesktopSidebarWidth,
  resetDesktopSidebarWidth,
} from "../../src/muse/sidebarWidth";

afterEach(() => {
  cleanup();
  resetDesktopSidebarWidth();
  vi.restoreAllMocks();
  document.body.classList.remove("is-panel-resizing");
});

const noop = () => {};

function renderSidebar() {
  return render(
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

describe("DesktopSidebar resize", () => {
  it("drags within min and max width", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("desktop-sidebar");
    const handle = screen.getByTestId("desktop-sidebar-resize");
    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 240,
    } as DOMRect);

    fireEvent.mouseDown(handle);
    expect(document.body.classList.contains("is-panel-resizing")).toBe(true);
    fireEvent.mouseMove(window, { clientX: 320 });
    expect(getDesktopSidebarWidth()).toBe(320);
    fireEvent.mouseMove(window, { clientX: 80 });
    expect(getDesktopSidebarWidth()).toBe(DESKTOP_SIDEBAR_MIN_WIDTH);
    fireEvent.mouseMove(window, { clientX: 900 });
    expect(getDesktopSidebarWidth()).toBe(DESKTOP_SIDEBAR_MAX_WIDTH);
    fireEvent.mouseUp(window);
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);
  });
});
