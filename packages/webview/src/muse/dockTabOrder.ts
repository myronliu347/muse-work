import { PANEL_ADD_ORDER } from "./panelTabs";

/** First dock tab. Not a panel kind. */
export const DOCK_TAB_DETAIL_KEY = "detail";

export function kindTabKey(kind: string): string {
  return `kind:${kind}`;
}

export function toolTabKey(id: string): string {
  return `tool:${id}`;
}

export function fileTabKey(path: string): string {
  return `file:${path}`;
}

export function filePathFromTabKey(key: string): string | null {
  return key.startsWith("file:") ? key.slice("file:".length) : null;
}

export function toolIdFromTabKey(key: string): string | null {
  return key.startsWith("tool:") ? key.slice("tool:".length) : null;
}

/** The tab the dock is showing, in the same key space as `orderedKeys`. */
export function activeDockTabKey(input: {
  orderedKeys: readonly string[];
  detailActive: boolean;
  activeKind: string;
  activeFilePath: string | null;
  activeToolId: string | null;
}): string | null {
  const { orderedKeys, detailActive, activeKind, activeFilePath, activeToolId } = input;
  if (detailActive && orderedKeys.includes(DOCK_TAB_DETAIL_KEY)) return DOCK_TAB_DETAIL_KEY;
  if (activeToolId) {
    const key = toolTabKey(activeToolId);
    if (orderedKeys.includes(key)) return key;
  }
  if (activeKind === "file" && activeFilePath) {
    const key = fileTabKey(activeFilePath);
    if (orderedKeys.includes(key)) return key;
  }
  const kindKey = kindTabKey(activeKind);
  return orderedKeys.includes(kindKey) ? kindKey : null;
}

export interface DockTabSource {
  detail: boolean;
  checked: readonly string[];
  filePaths: readonly string[];
  tools: readonly { id: string; kind: string }[];
}

/**
 * Order used before the user drags or opens a tab beside the current one:
 * 详情, then 文件、终端、浏览器、变更. Tool tabs take their kind's slot.
 */
export function defaultDockTabKeys(source: DockTabSource): string[] {
  const keys: string[] = [];
  if (source.detail) keys.push(DOCK_TAB_DETAIL_KEY);
  const showFiles = source.filePaths.length > 0;
  for (const kind of PANEL_ADD_ORDER) {
    const mine = source.tools.filter((tool) => tool.kind === kind);
    if (mine.length > 0) {
      for (const tool of mine) keys.push(toolTabKey(tool.id));
      continue;
    }
    if (kind === "file" && showFiles) {
      for (const path of source.filePaths) keys.push(fileTabKey(path));
      continue;
    }
    if (source.checked.includes(kind)) keys.push(kindTabKey(kind));
  }
  return keys;
}

function placeUnclaimedFiles(
  present: readonly string[],
  presentSet: Set<string>,
  result: string[],
  used: Set<string>,
) {
  for (const key of present) {
    if (key.startsWith("file:") && presentSet.has(key) && !used.has(key)) {
      result.push(key);
      used.add(key);
    }
  }
  if (presentSet.has(kindTabKey("file")) && !used.has(kindTabKey("file"))) {
    result.push(kindTabKey("file"));
    used.add(kindTabKey("file"));
  }
}

/** Keep a saved order, drop closed tabs, and place new ones near their default neighbors. */
export function reconcileTabOrder(
  stored: readonly string[] | undefined,
  present: readonly string[],
): string[] {
  if (!stored || stored.length === 0) return [...present];
  const presentSet = new Set(present);
  const result: string[] = [];
  const used = new Set<string>();
  for (const key of stored) {
    if (key === kindTabKey("file")) {
      placeUnclaimedFiles(present, presentSet, result, used);
      continue;
    }
    if (key.startsWith("file:") && !presentSet.has(key)) {
      placeUnclaimedFiles(present, presentSet, result, used);
      continue;
    }
    if (presentSet.has(key) && !used.has(key)) {
      result.push(key);
      used.add(key);
    }
  }
  for (const key of present) {
    if (used.has(key)) continue;
    let insertAt = 0;
    const idx = present.indexOf(key);
    for (let i = idx - 1; i >= 0; i -= 1) {
      const at = result.indexOf(present[i]);
      if (at >= 0) {
        insertAt = at + 1;
        break;
      }
    }
    result.splice(insertAt, 0, key);
    used.add(key);
  }
  return result;
}

/** Put `newKey` immediately after the tab the user is looking at. */
export function insertTabAfterCurrent(
  stored: readonly string[] | undefined,
  present: readonly string[],
  currentKey: string | null,
  newKey: string,
): string[] {
  const base = reconcileTabOrder(
    stored,
    present.filter((key) => key !== newKey),
  ).filter((key) => key !== newKey);
  const at = currentKey ? base.indexOf(currentKey) : -1;
  const index = at >= 0 ? at + 1 : base.length;
  base.splice(index, 0, newKey);
  return base;
}

/** Move `fromKey` to the near or far side of `toKey`. */
export function moveDockTab(
  order: readonly string[],
  fromKey: string,
  toKey: string,
  after: boolean,
): string[] {
  if (fromKey === toKey) return [...order];
  const next = order.filter((key) => key !== fromKey);
  let index = next.indexOf(toKey);
  if (index < 0) return [...order];
  if (after) index += 1;
  next.splice(index, 0, fromKey);
  return next;
}
