/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DesktopSidebar } from "../../src/components/desktop/DesktopSidebar";
import { DESKTOP_SIDEBAR_WIDTH } from "../../src/muse/layout";

afterEach(() => {
  cleanup();
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
  it("is a fixed icon rail without a drag handle", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("desktop-sidebar");
    expect(sidebar.className).toContain("desktop-icon-rail");
    expect(DESKTOP_SIDEBAR_WIDTH).toBe(52);
    expect(screen.queryByTestId("desktop-sidebar-resize")).toBeNull();
    expect(document.body.classList.contains("is-panel-resizing")).toBe(false);
  });
});
