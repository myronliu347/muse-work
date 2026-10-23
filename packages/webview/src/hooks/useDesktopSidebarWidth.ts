import { useSyncExternalStore } from "react";
import {
  getDesktopSessionListWidth,
  getDesktopSidebarWidth,
  setDesktopSessionListWidth,
  setDesktopSidebarWidth,
  subscribeDesktopSessionListWidth,
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

export function useDesktopSessionListWidth(): {
  width: number;
  setWidth: (width: number) => void;
} {
  const width = useSyncExternalStore(
    subscribeDesktopSessionListWidth,
    getDesktopSessionListWidth,
    getDesktopSessionListWidth,
  );
  return { width, setWidth: setDesktopSessionListWidth };
}
