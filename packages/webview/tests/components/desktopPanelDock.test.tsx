/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopPanelDock } from "../../src/components/desktop/DesktopPanelDock";
import { MuseTheme } from "../../src/ui/theme";
import type { FileViewState } from "../../src/types";

const fileTab = (
  path: string,
  overrides: Partial<FileViewState> = {},
): FileViewState => ({ path, host: "local", content: "x", ...overrides });

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

  it("opens the add menu when clicking +", async () => {
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <DesktopPanelDock {...baseProps} checked={["diff"]} active="diff">
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    await user.click(screen.getByTestId("desktop-panel-add-btn"));
    expect(await screen.findByTestId("panel-add-menu")).toBeInTheDocument();
    expect(screen.getByTestId("panel-add-item-file")).toBeInTheDocument();
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

  describe("top-level file tabs", () => {
    const tabs = [
      fileTab("/w/app.ts", { pinned: true }),
      fileTab("/w/b.ts"),
    ];

    it("replaces the 文件 kind tab with file-name tabs while the file panel is active", () => {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["preview", "file"]}
            active="file"
            fileTabs={tabs}
            activeFilePath="/w/app.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      // File-name tabs replace the 文件 kind tab; other kinds stay.
      expect(screen.queryByTestId("desktop-panel-tab-file")).toBeNull();
      expect(screen.getByTestId("desktop-panel-tab-preview")).toBeInTheDocument();
      const fileTabEls = screen.getAllByTestId("file-tab");
      expect(fileTabEls).toHaveLength(2);
      expect(fileTabEls[0]).toHaveAttribute("data-active", "true");
      expect(fileTabEls[1]).toHaveAttribute("data-active", "false");
    });

    it("keeps the 文件 kind tab when no files are open", () => {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["preview", "file"]}
            active="file"
            fileTabs={[]}
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      expect(screen.getByTestId("desktop-panel-tab-file")).toBeInTheDocument();
      expect(screen.queryAllByTestId("file-tab")).toHaveLength(0);
    });

    it("keeps file tabs visible when another panel is active (switching away does not lose open files)", () => {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["preview", "file"]}
            active="preview"
            fileTabs={tabs}
            activeFilePath="/w/app.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      expect(screen.getAllByTestId("file-tab")).toHaveLength(2);
      expect(screen.queryByTestId("desktop-panel-tab-file")).toBeNull();
      expect(screen.getByTestId("desktop-panel-tab-preview")).toBeInTheDocument();
    });

    it("styles preview tabs italic and shows a close button on every tab", () => {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={tabs}
            activeFilePath="/w/app.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      const fileTabEls = screen.getAllByTestId("file-tab");
      expect(fileTabEls[0].classList.contains("file-tab--preview")).toBe(false);
      expect(fileTabEls[1].classList.contains("file-tab--preview")).toBe(true);
      expect(screen.getAllByTestId("file-tab-close")).toHaveLength(2);
      expect(screen.queryAllByTestId("file-tab-pin")).toHaveLength(0);
    });

    it("selects a file tab on click and closes on X without selecting", () => {
      const onSelectFileTab = vi.fn();
      const onCloseFileTab = vi.fn();
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={tabs}
            activeFilePath="/w/app.ts"
            onSelectFileTab={onSelectFileTab}
            onCloseFileTab={onCloseFileTab}
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );

      fireEvent.click(screen.getAllByTestId("file-tab")[1]);
      expect(onSelectFileTab).toHaveBeenCalledWith("/w/b.ts");

      fireEvent.click(screen.getAllByTestId("file-tab-close")[0]);
      expect(onCloseFileTab).toHaveBeenCalledWith("/w/app.ts");
      expect(onSelectFileTab).toHaveBeenCalledTimes(1);
    });

    it("pins a preview tab on double-click of the title", () => {
      const onPinFileTab = vi.fn();
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={tabs}
            activeFilePath="/w/app.ts"
            onPinFileTab={onPinFileTab}
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      fireEvent.dblClick(screen.getAllByTestId("file-tab")[1]);
      expect(onPinFileTab).toHaveBeenCalledWith("/w/b.ts");
    });
  });
});
