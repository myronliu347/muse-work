import { useSyncExternalStore } from "react";
import {
  getDesktopSidebarWidth,
  setDesktopSidebarWidth,
  subscribeDesktopSidebarWidth,
} from "../muse/sidebarWidth";

export function useDesktopSidebarWidth(): {
  width: number;
  setWidth: (width: number) => void;
} {
  const width = useSyncExternalStore(
    subscribeDesktopSidebarWidth,
    getDesktopSidebarWidth,
    getDesktopSidebarWidth,
  );
  return { width, setWidth: setDesktopSidebarWidth };
}
