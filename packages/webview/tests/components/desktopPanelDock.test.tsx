/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DesktopPanelDock } from "../../src/components/DesktopPanelDock";
import { MuseTheme } from "../../src/ui/theme";

describe("DesktopPanelDock", () => {
  it("shows only open tabs with 浏览器/变更 labels and layout toggle", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock
          checked={["preview", "diff"]}
          active="diff"
          onSelect={() => {}}
          onCloseTab={() => {}}
          panelToggle={{ checked: ["preview", "diff"], onToggle: () => {} }}
          width={420}
          onWidthChange={() => {}}
          maxWidth={800}
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
          checked={["preview", "diff"]}
          active="preview"
          onSelect={onSelect}
          onCloseTab={onCloseTab}
          panelToggle={{ checked: ["preview", "diff"], onToggle: () => {} }}
          width={420}
          onWidthChange={() => {}}
          maxWidth={800}
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
});
