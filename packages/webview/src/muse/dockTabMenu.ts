import { DOCK_TAB_DETAIL_KEY } from "./dockTabOrder";

export type DockTabCloseMode = "one" | "others" | "right" | "all";

/** 详情没有关闭按钮，批量关闭也不动它。 */
export function isCloseableDockTab(key: string): boolean {
  return key !== DOCK_TAB_DETAIL_KEY;
}

/** Tabs a context-menu close action should remove, in bar order. */
export function dockTabsToClose(
  orderedKeys: readonly string[],
  clickedKey: string,
  mode: DockTabCloseMode,
): string[] {
  const index = orderedKeys.indexOf(clickedKey);
  if (index < 0) return [];
  if (mode === "one") {
    return isCloseableDockTab(clickedKey) ? [clickedKey] : [];
  }
  if (mode === "others") {
    return orderedKeys.filter((key) => key !== clickedKey && isCloseableDockTab(key));
  }
  if (mode === "right") {
    return orderedKeys.slice(index + 1).filter(isCloseableDockTab);
  }
  return orderedKeys.filter(isCloseableDockTab);
}
