/** @vitest-environment jsdom */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DesktopSidebarToggle } from "../../src/components/desktop/DesktopSidebarToggle";
import {
  getDesktopSidebarCollapsed,
  resetDesktopSidebarCollapsed,
} from "../../src/muse/sidebarCollapsed";

afterEach(() => {
  cleanup();
  resetDesktopSidebarCollapsed();
});

describe("DesktopSidebarToggle", () => {
  it("toggles collapsed state", () => {
    render(<DesktopSidebarToggle />);
    const btn = screen.getByTestId("desktop-sidebar-toggle");
    expect(getDesktopSidebarCollapsed()).toBe(false);
    fireEvent.click(btn);
    expect(getDesktopSidebarCollapsed()).toBe(true);
    fireEvent.click(btn);
    expect(getDesktopSidebarCollapsed()).toBe(false);
  });
});
