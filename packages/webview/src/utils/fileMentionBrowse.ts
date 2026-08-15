export function dirFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\/+$/, "");
}

export function parentBrowsePath(browsePath: string): string {
  const parts = dirFromRelativePath(browsePath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function breadcrumbCrumbs(
  browsePath: string,
): Array<{ label: string; path: string }> {
  const crumbs = [{ label: "工作区", path: "" }];
  const parts = dirFromRelativePath(browsePath).split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

export function fileSuggestionsRequestPayload(
  filterText: string,
  browsePath: string,
  requestId: string,
  workdir?: string,
): {
  command: "requestFileSuggestions";
  filterText: string;
  requestId: string;
  dir?: string;
  workdir?: string;
} {
  const payload: {
    command: "requestFileSuggestions";
    filterText: string;
    requestId: string;
    dir?: string;
    workdir?: string;
  } = {
    command: "requestFileSuggestions",
    filterText,
    requestId,
  };
  if (workdir) payload.workdir = workdir;
  if (filterText.trim() === "") {
    payload.dir = browsePath;
  }
  return payload;
}

/** Shown whenever the @ mention is live-active (browse, search, empty, or loading). */
export function isFileMentionDropdownVisible(opts: {
  isActive: boolean;
  suggestionCount?: number;
  filterText?: string;
  isLoading?: boolean;
}): boolean {
  return opts.isActive;
}

export type FileMentionKeyAction =
  | { type: "move"; delta: number }
  | { type: "select"; index: number }
  | { type: "enterDir"; index: number }
  | { type: "goUp" }
  | { type: "close" };

export function resolveFileMentionKey(opts: {
  key: string;
  filterText: string;
  browsePath: string;
  suggestions: Array<{ isDirectory: boolean }>;
  selectedIndex: number;
}): FileMentionKeyAction | null {
  const { key, filterText, browsePath, suggestions, selectedIndex } = opts;

  switch (key) {
    case "ArrowUp":
      return suggestions.length > 0 ? { type: "move", delta: -1 } : null;
    case "ArrowDown":
      return suggestions.length > 0 ? { type: "move", delta: 1 } : null;
    case "Enter":
      return { type: "select", index: selectedIndex };
    case "ArrowRight":
      return suggestions[selectedIndex]?.isDirectory
        ? { type: "enterDir", index: selectedIndex }
        : null;
    case "ArrowLeft":
      return browsePath ? { type: "goUp" } : null;
    case "Backspace":
      return !filterText && browsePath ? { type: "goUp" } : null;
    case "Escape":
      return { type: "close" };
    default:
      return null;
  }
}
