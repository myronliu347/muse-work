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
      expect(screen.getByTestId("desktop-panel-tab-preview")).toHaveClass(
        "desktop-panel-tab--active",
      );
      expect(
        screen.getAllByTestId("file-tab").every((el) => el.getAttribute("data-active") === "false"),
      ).toBe(true);
    });

    it("does not highlight a file tab while 终端 is the active panel", () => {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["diff", "terminal", "file"]}
            active="terminal"
            fileTabs={tabs}
            activeFilePath="/w/app.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      expect(screen.getByTestId("desktop-panel-tab-terminal")).toHaveClass(
        "desktop-panel-tab--active",
      );
      expect(screen.getByTestId("desktop-panel-tab-diff")).not.toHaveClass(
        "desktop-panel-tab--active",
      );
      const fileTabEls = screen.getAllByTestId("file-tab");
      expect(fileTabEls[0]).toHaveAttribute("data-active", "false");
      expect(fileTabEls[0]).not.toHaveClass("file-tab--active");
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

  describe("scrolls the active tab into view", () => {
    const manyTabs = Array.from({ length: 10 }, (_, i) =>
      fileTab(`/w/tab-${i}.ts`),
    );
    const renderDock = (activeFilePath: string) =>
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={manyTabs}
            activeFilePath={activeFilePath}
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
    // jsdom has no layout: fake a 200px-wide scroll container where every tab
    // is 80px wide starting at offsetLeft = index * 80 (i.e. tabs 0-2 visible,
    // tab 8's right edge at 720 sits well outside the viewport).
    const mockLayout = (container: HTMLElement) => {
      Object.defineProperty(container, "clientWidth", {
        configurable: true,
        value: 200,
      });
      screen.getAllByTestId("file-tab").forEach((el, i) => {
        Object.defineProperty(el, "offsetLeft", {
          configurable: true,
          value: i * 80,
        });
        Object.defineProperty(el, "offsetWidth", {
          configurable: true,
          value: 80,
        });
      });
    };

    it("does not scroll on initial mount even when the active tab is far right", () => {
      renderDock("/w/tab-9.ts");
      const container = document.querySelector(
        ".desktop-panel-dock-tabs",
      ) as HTMLElement;
      mockLayout(container);
      expect(container.scrollLeft).toBe(0);
    });

    it("scrolls right when switching to a tab beyond the visible area", () => {
      const { rerender } = renderDock("/w/tab-0.ts");
      const container = document.querySelector(
        ".desktop-panel-dock-tabs",
      ) as HTMLElement;
      mockLayout(container);

      rerender(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={manyTabs}
            activeFilePath="/w/tab-8.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );

      // Tab 8 right edge (720) is outside clientWidth (200): align it in.
      expect(container.scrollLeft).toBe(520);
    });

    it("scrolls back left when the active tab moves out of view to the left", () => {
      const { rerender } = renderDock("/w/tab-0.ts");
      const container = document.querySelector(
        ".desktop-panel-dock-tabs",
      ) as HTMLElement;
      mockLayout(container);

      // First jump far right (tab 8) then back to tab 0, now left of the viewport.
      rerender(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={manyTabs}
            activeFilePath="/w/tab-8.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      expect(container.scrollLeft).toBe(520);
      rerender(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={manyTabs}
            activeFilePath="/w/tab-0.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      expect(container.scrollLeft).toBe(0);
    });

    it("leaves the scroll position untouched when the tab is already visible", () => {
      const { rerender } = renderDock("/w/tab-0.ts");
      const container = document.querySelector(
        ".desktop-panel-dock-tabs",
      ) as HTMLElement;
      mockLayout(container);

      // Tab 1 spans 80-160, fully inside the 200px viewport: no jump needed.
      rerender(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["file"]}
            active="file"
            fileTabs={manyTabs}
            activeFilePath="/w/tab-1.ts"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      expect(container.scrollLeft).toBe(0);
    });
  });
});
