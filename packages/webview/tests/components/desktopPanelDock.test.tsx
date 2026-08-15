/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DesktopPanelDock } from "../../src/components/desktop/DesktopPanelDock";
import { MuseTheme } from "../../src/ui/theme";

const baseProps = {
  onSelect: () => {},
  onCloseTab: () => {},
  onAddPanel: () => {},
  panelToggle: { onToggleDock: () => {} },
  fullscreen: false,
  onToggleFullscreen: () => {},
  width: 420,
  onWidthChange: () => {},
  maxWidth: 800,
};

describe("DesktopPanelDock", () => {
  it("shows only open tabs with 浏览器/变更 labels and layout toggle", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["preview", "diff"]}
          active="diff"
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    const previewTab = screen.getByTestId("desktop-panel-tab-preview");
    const diffTab = screen.getByTestId("desktop-panel-tab-diff");
    expect(previewTab).toHaveTextContent("浏览器");
    expect(diffTab).toHaveTextContent("变更");
    expect(previewTab.querySelector(".codicon-globe")).toBeTruthy();
    expect(diffTab.querySelector(".codicon-diff")).toBeTruthy();
    expect(screen.queryByTestId("desktop-panel-tab-terminal")).toBeNull();
    expect(screen.getByTestId("panel-toggle-btn")).toBeInTheDocument();
  });

  it("selects a tab on label click and closes on X without selecting", () => {
    const onSelect = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["preview", "diff"]}
          active="preview"
          onSelect={onSelect}
          onCloseTab={onCloseTab}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    fireEvent.click(screen.getByText("变更"));
    expect(onSelect).toHaveBeenCalledWith("diff");

    fireEvent.click(screen.getByTestId("desktop-panel-tab-close-preview"));
    expect(onCloseTab).toHaveBeenCalledWith("preview");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows + when panels remain, hides when all open", () => {
    const { rerender } = render(
      <MuseTheme>
        <DesktopPanelDock {...baseProps} checked={["preview"]} active="preview">
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    expect(screen.getByTestId("desktop-panel-add-btn")).toBeInTheDocument();

    rerender(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["preview", "diff", "terminal", "file"]}
          active="file"
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    expect(screen.queryByTestId("desktop-panel-add-btn")).toBeNull();
  });

  it("toggles fullscreen via header button", () => {
    const onToggleFullscreen = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["diff"]}
          active="diff"
          onToggleFullscreen={onToggleFullscreen}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    fireEvent.click(screen.getByTestId("desktop-panel-fullscreen-btn"));
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("marks dock fullscreen class when fullscreen", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["diff"]}
          active="diff"
          fullscreen
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    expect(screen.getByTestId("desktop-panel-dock").className).toContain(
      "desktop-panel-dock--fullscreen",
    );
  });
});
