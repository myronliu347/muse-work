import React, { useEffect } from "react";
import { LayoutSidebarLeftIcon } from "../shared/HeaderIcons";
import { Tooltip } from "../shared/Tooltip";
import { useDesktopSidebarCollapsed } from "../../hooks/useDesktopSidebarCollapsed";

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().startsWith("MAC");

/** Titlebar control (right of traffic lights) that shows/hides the overlay sidebar. */
export const DesktopSidebarToggle: React.FC = () => {
  const { collapsed, toggle } = useDesktopSidebarCollapsed();
  const shortcut = isMacPlatform() ? "⌘B" : "Ctrl+B";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b") return;
      if (!(isMacPlatform() ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) {
        return;
      }
      // Cmd/Ctrl+B is the app-level sidebar toggle even while the composer
      // has focus; the composer is plain text and does not use it for bold.
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="desktop-shell-chrome">
      <Tooltip
        text={collapsed ? `展开侧栏 ${shortcut}` : `收起侧栏 ${shortcut}`}
        position="bottom"
        wrap={false}
      >
        <button
          type="button"
          className="desktop-sidebar-toggle"
          data-testid="desktop-sidebar-toggle"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-pressed={!collapsed}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggle}
        >
          <LayoutSidebarLeftIcon />
        </button>
      </Tooltip>
    </div>
  );
};
