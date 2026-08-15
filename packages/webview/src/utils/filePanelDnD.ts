/** Drag/clipboard MIME helpers for File panel ↔ chat input. */

export const FILE_TREE_DRAG_MIME = "application/x-muse-file-tree";
export const FILE_SELECTION_CLIPBOARD_MIME =
  "application/x-muse-file-selection";

export type FileTreeDragPayload = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
};

export type FileSelectionClipboardPayload = {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  text: string;
};

export function encodeFileTreeDrag(payload: FileTreeDragPayload): string {
  return JSON.stringify(payload);
}

export function parseFileTreeDrag(raw: string): FileTreeDragPayload | null {
  try {
    const v = JSON.parse(raw) as FileTreeDragPayload;
    if (
      typeof v.path !== "string" ||
      typeof v.relativePath !== "string" ||
      typeof v.name !== "string" ||
      typeof v.isDirectory !== "boolean"
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

export function encodeFileSelectionClipboard(
  payload: FileSelectionClipboardPayload,
): string {
  return JSON.stringify(payload);
}

export function parseFileSelectionClipboard(
  raw: string,
): FileSelectionClipboardPayload | null {
  try {
    const v = JSON.parse(raw) as FileSelectionClipboardPayload;
    if (
      typeof v.filePath !== "string" ||
      typeof v.fileName !== "string" ||
      typeof v.startLine !== "number" ||
      typeof v.endLine !== "number"
    ) {
      return null;
    }
    return {
      ...v,
      text: typeof v.text === "string" ? v.text : "",
    };
  } catch {
    return null;
  }
}

/** Map a DOM selection inside `.file-pane-code` to 1-based line range. */
export function lineRangeFromFilePreviewSelection(
  root: HTMLElement,
): { startLine: number; endLine: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const lineEls = root.querySelectorAll(".file-pane-line");
  let startLine: number | null = null;
  let endLine: number | null = null;
  lineEls.forEach((el, i) => {
    try {
      if (range.intersectsNode(el)) {
        const n = i + 1;
        if (startLine === null) startLine = n;
        endLine = n;
      }
    } catch {
      /* intersectsNode can throw on detached nodes */
    }
  });
  if (startLine === null || endLine === null) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  return { startLine, endLine, text };
}
