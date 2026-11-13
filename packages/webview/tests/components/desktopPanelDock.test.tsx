/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesktopPanelDock } from "../../src/components/desktop/DesktopPanelDock";
import { registerUnfocusedClose } from "../../src/muse/sidePanelTabs";
import { MuseTheme } from "../../src/ui/theme";
import type { FileViewState } from "../../src/types";

const fileTab = (
  path: string,
  overrides: Partial<FileViewState> = {},
): FileViewState => ({ path, host: "local", content: "x", ...overrides });

/** Split drags paint on the next frame; the width commits on release. */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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

  it("previews the drag on the dock and commits the width once", async () => {
    const onWidthChange = vi.fn();
    const onWidthPreview = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["file"]}
          active="file"
          onWidthChange={onWidthChange}
          onWidthPreview={onWidthPreview}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    const dock = screen.getByTestId("desktop-panel-dock");
    vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({
      right: 1200,
    } as DOMRect);
    fireEvent.pointerDown(screen.getByTestId("desktop-panel-dock-resize"), {
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 800 }); // 1200 - 800 = 400
    await frame();
    // The drag paints the CSS var (and the layout's own grid) without state.
    expect(dock.style.getPropertyValue("--dock-width")).toBe("400px");
    expect(onWidthPreview).toHaveBeenLastCalledWith(400);
    expect(onWidthChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(window);
    expect(onWidthChange).toHaveBeenCalledWith(400);
    expect(onWidthChange).toHaveBeenCalledTimes(1);
  });

  it("shows the loaded page title on the browser tab", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["preview"]}
          active="preview"
          previewLabel="原型多端预览"
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    expect(screen.getByTestId("desktop-panel-tab-preview")).toHaveTextContent("原型多端预览");
  });

  it("renders a saved order and reports a drag", () => {
    const onTabOrderChange = vi.fn();
    const { rerender } = render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["file", "diff"]}
          active="diff"
          tabOrder={["kind:diff", "kind:file"]}
          onTabOrderChange={onTabOrderChange}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    const tabs = [...document.querySelectorAll(".desktop-panel-dock-tabs > .desktop-panel-tab")];
    expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, ""))).toEqual(["变更", "文件"]);

    rerender(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["file", "diff"]}
          active="diff"
          onTabOrderChange={onTabOrderChange}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    fireEvent.dragStart(screen.getByTestId("desktop-panel-tab-diff"));
    fireEvent.drop(screen.getByTestId("desktop-panel-tab-file"));
    expect(onTabOrderChange).toHaveBeenCalledWith(["kind:diff", "kind:file"]);
  });

  it("switches tabs with Cmd+[ ] when the dock was clicked, even if focus stayed outside", () => {
    const onSelect = vi.fn();
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const chord = mac ? { metaKey: true } : { ctrlKey: true };
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["file", "terminal", "preview"]}
          active="terminal"
          onSelect={onSelect}
        >
          <div data-testid="dock-body">body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    const body = screen.getByTestId("dock-body");
    fireEvent.pointerDown(body);
    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(document.body, { key: "]", code: "BracketRight", ...chord });
    expect(onSelect).toHaveBeenCalledWith("preview");

    onSelect.mockClear();
    fireEvent.keyDown(window, { key: "[", code: "BracketLeft", ...chord });
    expect(onSelect).toHaveBeenCalledWith("file");

    onSelect.mockClear();
    window.dispatchEvent(
      new MessageEvent("message", { data: { command: "desktopStepTab", direction: 1 } }),
    );
    expect(onSelect).toHaveBeenCalledWith("preview");

    onSelect.mockClear();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "]", code: "BracketRight", ...chord });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes the focused dock tab with Cmd+W and leaves 详情", () => {
    const onCloseTab = vi.fn();
    const onCloseTool = vi.fn();
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const chord = mac ? { metaKey: true } : { ctrlKey: true };
    const { rerender } = render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["terminal", "file"]}
          active="terminal"
          onCloseTab={onCloseTab}
        >
          <div data-testid="dock-body">body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(10_000);
    fireEvent.pointerDown(screen.getByTestId("dock-body"));
    fireEvent.keyDown(document.body, { key: "w", code: "KeyW", ...chord });
    expect(onCloseTab).toHaveBeenCalledWith("terminal");

    onCloseTab.mockClear();
    now.mockReturnValue(10_400);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "w", code: "KeyW", ...chord });
    expect(onCloseTab).not.toHaveBeenCalled();

    now.mockReturnValue(10_800);
    rerender(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["terminal"]}
          active="terminal"
          detailActive
          onSelectDetail={() => {}}
          onCloseTab={onCloseTab}
          onCloseTool={onCloseTool}
          toolTabs={[{ id: "wave", kind: "terminal", label: "wave", title: "wave" }]}
          activeToolId="wave"
        >
          <div data-testid="dock-body">body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    fireEvent.pointerDown(screen.getByTestId("dock-body"));
    fireEvent.keyDown(document.body, { key: "w", code: "KeyW", ...chord });
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(onCloseTool).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("keeps the window open when Cmd+W cannot close the focused dock tab", () => {
    const closeWindow = vi.fn();
    const unregister = registerUnfocusedClose(closeWindow);
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const chord = mac ? { metaKey: true } : { ctrlKey: true };
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(30_000);
    try {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["terminal"]}
            active="terminal"
            detailActive
            onSelectDetail={() => {}}
          >
            <div data-testid="dock-body">body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      fireEvent.pointerDown(screen.getByTestId("dock-body"));
      fireEvent.keyDown(document.body, { key: "w", code: "KeyW", ...chord });
      expect(closeWindow).not.toHaveBeenCalled();

      now.mockReturnValue(30_400);
      fireEvent.pointerDown(document.body);
      fireEvent.keyDown(document.body, { key: "w", code: "KeyW", ...chord });
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      unregister();
    }
  });

  it("steps the highlighted tab when a browser tab is only remembered", () => {
    const onSelect = vi.fn();
    const onSelectDetail = vi.fn();
    const onSelectTool = vi.fn();
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const chord = mac ? { metaKey: true } : { ctrlKey: true };
    const { rerender } = render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["preview", "diff"]}
          active="diff"
          onSelect={onSelect}
          onSelectDetail={onSelectDetail}
          detailTitle="分析 sandbox 项"
          toolTabs={[{ id: "wave", kind: "preview", label: "wave-agent 项目", title: "wave-agent 项目" }]}
          activeToolId="wave"
          onSelectTool={onSelectTool}
        >
          <div data-testid="dock-body">body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    fireEvent.pointerDown(screen.getByTestId("dock-body"));
    fireEvent.keyDown(document.body, { key: "[", code: "BracketLeft", ...chord });
    expect(onSelectTool).toHaveBeenCalledWith("wave");
    expect(onSelectDetail).not.toHaveBeenCalled();

    onSelectTool.mockClear();
    window.dispatchEvent(
      new MessageEvent("message", { data: { command: "desktopStepTab", direction: -1 } }),
    );
    expect(onSelectTool).not.toHaveBeenCalled();
    expect(onSelectDetail).not.toHaveBeenCalled();

    rerender(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["preview", "diff"]}
          active="diff"
          onSelect={onSelect}
          onSelectDetail={onSelectDetail}
          detailActive
          detailTitle="分析 sandbox 项"
          toolTabs={[{ id: "wave", kind: "preview", label: "wave-agent 项目", title: "wave-agent 项目" }]}
          activeToolId="wave"
          onSelectTool={onSelectTool}
        >
          <div data-testid="dock-body">body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    fireEvent.pointerDown(screen.getByTestId("dock-body"));
    fireEvent.keyDown(document.body, { key: "]", code: "BracketRight", ...chord });
    expect(onSelectTool).toHaveBeenCalledWith("wave");
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

  it("shows + on a detail-only dock so the four tool tabs can be added", () => {
    render(
      <MuseTheme>
        <DesktopPanelDock {...baseProps} checked={[]} active="file">
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    expect(screen.getByTestId("desktop-panel-add-btn")).toBeInTheDocument();
  });

  it("keeps + for 文件 even when every kind is open", () => {
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
    expect(screen.getByTestId("desktop-panel-add-btn")).toBeInTheDocument();
  });

  it("opens the panel picker page when clicking +", async () => {
    const user = userEvent.setup();
    render(
      <MuseTheme>
        <DesktopPanelDock {...baseProps} checked={["diff"]} active="diff">
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );
    await user.click(screen.getByTestId("desktop-panel-add-btn"));
    expect(await screen.findByTestId("panel-picker")).toBeInTheDocument();
    expect(screen.getByTestId("panel-add-item-file")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-panel-tab-new")).toBeInTheDocument();
  });

  it("turns the blank picker tab into the chosen panel", async () => {
    const user = userEvent.setup();
    const onAddPanel = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["diff"]}
          active="diff"
          onAddPanel={onAddPanel}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    await user.click(screen.getByTestId("desktop-panel-add-btn"));
    expect(screen.getByTestId("panel-picker")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-panel-tab-new")).toBeInTheDocument();
    expect(screen.queryByText("body")).toBeNull();

    await user.click(screen.getByTestId("panel-add-item-terminal"));
    expect(onAddPanel).toHaveBeenCalledWith("terminal");
    expect(screen.queryByTestId("panel-picker")).toBeNull();
    expect(screen.queryByTestId("desktop-panel-tab-new")).toBeNull();
  });

  it("closes the blank picker tab without adding a panel", async () => {
    const user = userEvent.setup();
    const onAddPanel = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["diff"]}
          active="diff"
          onAddPanel={onAddPanel}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    await user.click(screen.getByTestId("desktop-panel-add-btn"));
    await user.click(screen.getByTestId("desktop-panel-tab-close-new"));
    expect(onAddPanel).not.toHaveBeenCalled();
    expect(screen.queryByTestId("panel-picker")).toBeNull();
    expect(screen.getByText("body")).toBeInTheDocument();
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

    it("scrolls a kind tab into view when 变更 is clicked past the edge", () => {
      render(
        <MuseTheme>
          <DesktopPanelDock
            {...baseProps}
            checked={["preview", "diff"]}
            active="preview"
          >
            <div>body</div>
          </DesktopPanelDock>
        </MuseTheme>,
      );
      const container = document.querySelector(
        ".desktop-panel-dock-tabs",
      ) as HTMLElement;
      Object.defineProperty(container, "clientWidth", {
        configurable: true,
        value: 200,
      });
      const diff = screen.getByTestId("desktop-panel-tab-diff");
      Object.defineProperty(diff, "offsetLeft", { configurable: true, value: 400 });
      Object.defineProperty(diff, "offsetWidth", { configurable: true, value: 126 });

      fireEvent.click(diff.querySelector("button")!);
      expect(container.scrollLeft).toBe(326);
    });
  });

  it("closes the tab under the pointer, the others, those to the right, or all of them", () => {
    const onCloseTab = vi.fn();
    const onSelect = vi.fn();
    const onCloseDock = vi.fn();
    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["terminal", "preview", "diff"]}
          active="diff"
          onCloseTab={onCloseTab}
          onSelect={onSelect}
          onCloseDock={onCloseDock}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    fireEvent.contextMenu(screen.getByTestId("desktop-panel-tab-terminal"));
    expect(screen.getByTestId("dock-tab-menu")).toHaveTextContent("关闭");
    expect(screen.queryByTestId("dock-tab-menu-add-chat")).toBeNull();
    fireEvent.click(screen.getByTestId("dock-tab-menu-close"));
    expect(onCloseTab).toHaveBeenCalledWith("terminal");
    expect(onSelect).toHaveBeenCalledWith("terminal");

    onCloseTab.mockClear();
    fireEvent.contextMenu(screen.getByTestId("desktop-panel-tab-preview"));
    fireEvent.click(screen.getByTestId("dock-tab-menu-close-right"));
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith("diff");

    onCloseTab.mockClear();
    fireEvent.contextMenu(screen.getByTestId("desktop-panel-tab-terminal"));
    fireEvent.click(screen.getByTestId("dock-tab-menu-close-others"));
    expect(onCloseTab.mock.calls.map((call) => call[0]).sort()).toEqual([
      "diff",
      "preview",
    ]);

    expect(onCloseDock).not.toHaveBeenCalled();
    onCloseTab.mockClear();
    fireEvent.contextMenu(screen.getByTestId("desktop-panel-tab-diff"));
    fireEvent.click(screen.getByTestId("dock-tab-menu-close-all"));
    expect(onCloseTab.mock.calls.map((call) => call[0]).sort()).toEqual([
      "diff",
      "preview",
      "terminal",
    ]);
    expect(onCloseDock).toHaveBeenCalledTimes(1);
  });

  it("keeps 详情 and offers file actions on a file tab", async () => {
    const onCloseTab = vi.fn();
    const onCloseFileTab = vi.fn();
    const onAddFileToChat = vi.fn();
    const onRevealFile = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const messages: unknown[] = [];
    const onMessage = (event: MessageEvent) => messages.push(event.data);
    window.addEventListener("message", onMessage);

    render(
      <MuseTheme>
        <DesktopPanelDock
          {...baseProps}
          checked={["diff"]}
          active="file"
          onCloseTab={onCloseTab}
          onSelectDetail={() => {}}
          fileTabs={[fileTab("/repo/a.ts")]}
          activeFilePath="/repo/a.ts"
          onCloseFileTab={onCloseFileTab}
          onAddFileToChat={onAddFileToChat}
          onRevealFile={onRevealFile}
        >
          <div>body</div>
        </DesktopPanelDock>
      </MuseTheme>,
    );

    fireEvent.contextMenu(screen.getByTestId("desktop-panel-tab-detail"));
    expect(screen.getByTestId("dock-tab-menu-close")).toBeDisabled();
    fireEvent.click(screen.getByTestId("dock-tab-menu-close-all"));
    expect(onCloseFileTab).toHaveBeenCalledWith("/repo/a.ts");
    expect(onCloseTab).toHaveBeenCalledWith("diff");

    onCloseFileTab.mockClear();
    fireEvent.contextMenu(screen.getByTestId("file-tab"));
    fireEvent.click(screen.getByTestId("dock-tab-menu-add-chat"));
    expect(onAddFileToChat).toHaveBeenCalledWith("/repo/a.ts");

    fireEvent.contextMenu(screen.getByTestId("file-tab"));
    fireEvent.click(screen.getByTestId("dock-tab-menu-reveal"));
    expect(onRevealFile).toHaveBeenCalledWith("/repo/a.ts");

    fireEvent.contextMenu(screen.getByTestId("file-tab"));
    fireEvent.click(screen.getByTestId("dock-tab-menu-copy"));
    await waitFor(() => {
      expect(messages).toContainEqual({
        command: "showToast",
        toast: { id: "dock-copy-path", message: "已复制路径" },
      });
    });
    expect(writeText).toHaveBeenCalledWith("/repo/a.ts");
    window.removeEventListener("message", onMessage);
  });
});
