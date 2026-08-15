import type { DesktopPanelKind } from "../types";
import type { CollapsedTabs } from "./panelTabs";
import { resolveOpenDockTabs, snapshotCollapsedTabs } from "./panelTabs";

export function collapseDockState(input: {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind | null;
}): {
  collapsedTabs: CollapsedTabs;
  checked: [];
  active: null;
  dockFullscreen: false;
} {
  const snap = snapshotCollapsedTabs(input.checked, input.active);
  return {
    collapsedTabs: snap ?? { checked: [], active: null },
    checked: [],
    active: null,
    dockFullscreen: false,
  };
}

export function expandDockState(collapsedTabs: CollapsedTabs | null): {
  checked: DesktopPanelKind[];
  active: DesktopPanelKind;
  collapsedTabs: null;
  dockFullscreen: false;
} {
  const opened = resolveOpenDockTabs(collapsedTabs);
  return {
    checked: opened.checked,
    active: opened.active,
    collapsedTabs: null,
    dockFullscreen: false,
  };
}
