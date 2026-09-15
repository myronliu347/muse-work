import { useSyncExternalStore } from "react";
import {
  getDesktopSidebarCollapsed,
  setDesktopSidebarCollapsed,
  subscribeDesktopSidebarCollapsed,
  toggleDesktopSidebarCollapsed,
} from "../muse/sidebarCollapsed";

export function useDesktopSidebarCollapsed(): {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
} {
  const collapsed = useSyncExternalStore(
    subscribeDesktopSidebarCollapsed,
    getDesktopSidebarCollapsed,
    getDesktopSidebarCollapsed,
  );
  return {
    collapsed,
    setCollapsed: setDesktopSidebarCollapsed,
    toggle: toggleDesktopSidebarCollapsed,
  };
}
