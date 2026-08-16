/**
 * Find-in-file helpers for the file preview panel: locate substring matches
 * across plain text lines, and wrap them with `<mark>` inside shiki-highlighted
 * line HTML without touching tag markup.
 */

export interface LineMatch {
  /** 0-based column range within the plain line text. */
  start: number;
  end: number;
}

export interface FileSearchMatch {
  /** 0-based line index. */
  lineIndex: number;
  /** 0-based column range within the plain line text. */
  startCol: number;
  endCol: number;
}

/** Find all case-insensitive substring matches across lines (0-based). */
export function findMatches(lines: string[], query: string): FileSearchMatch[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const out: FileSearchMatch[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const hay = line.toLowerCase();
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx === -1) break;
      out.push({ lineIndex: li, startCol: idx, endCol: idx + needle.length });
      from = idx + needle.length;
    }
  }
  return out;
}

type HtmlItem =
  | { type: "tag"; html: string }
  | { type: "text"; html: string; plain: string };

/** Split a highlighted line into escaped-text items and tag items. */
function parseLineHtml(lineHtml: string): HtmlItem[] {
  const items: HtmlItem[] = [];
  let i = 0;
  while (i < lineHtml.length) {
    const ch = lineHtml[i];
    if (ch === "<") {
      const end = lineHtml.indexOf(">", i);
      if (end === -1) {
        // Unclosed `<` — treat the remainder as text to stay safe.
        items.push({ type: "text", html: lineHtml.slice(i), plain: lineHtml.slice(i) });
        break;
      }
      items.push({ type: "tag", html: lineHtml.slice(i, end + 1) });
      i = end + 1;
      continue;
    }
    if (ch === "&") {
      const semicolon = lineHtml.indexOf(";", i);
      const entity = semicolon === -1 ? "" : lineHtml.slice(i, semicolon + 1);
      const decoded =
        entity === "&amp;" ? "&" : entity === "&lt;" ? "<" : entity === "&gt;" ? ">" : null;
      if (decoded !== null) {
        items.push({ type: "text", html: entity, plain: decoded });
        i = semicolon + 1;
        continue;
      }
    }
    items.push({ type: "text", html: ch, plain: ch });
    i++;
  }
  return items;
}

const MARK_CLASS = "file-pane-search-mark";
const MARK_CLASS_CURRENT = `${MARK_CLASS} ${MARK_CLASS}--current`;

/**
 * Wrap the given plain-line matches with `<mark class="file-pane-search-mark">`
 * inside the shiki-highlighted HTML fragment for that line. Matches must be
 * sorted, non-overlapping ranges over `plainLine`. Tag markup (and any
 * query-like text inside attributes) is preserved untouched. When `active`
 * (one of `matches`) is given, that match gets the extra
 * `file-pane-search-mark--current` class.
 */
export function wrapLineMatches(
  lineHtml: string,
  plainLine: string,
  matches: LineMatch[],
  active?: LineMatch,
): string {
  if (matches.length === 0) return lineHtml;
  const items = parseLineHtml(lineHtml);
  // Cover the plain range of every match in one pass: 1 = normal, 2 = active.
  const covered = new Array<number>(plainLine.length).fill(0);
  for (const m of matches) {
    for (let i = Math.max(0, m.start); i < Math.min(plainLine.length, m.end); i++) {
      covered[i] = 1;
    }
  }
  if (active) {
    for (let i = Math.max(0, active.start); i < Math.min(plainLine.length, active.end); i++) {
      covered[i] = 2;
    }
  }
  let plainIdx = 0;
  let out = "";
  let inMark = 0; // 0 = off, 1 = normal mark, 2 = active mark
  const flushMark = () => {
    if (inMark) {
      out += "</mark>";
      inMark = 0;
    }
  };
  for (const item of items) {
    if (item.type === "tag") {
      // Break the mark run at tag boundaries so nesting stays valid.
      flushMark();
      out += item.html;
      continue;
    }
    const state = covered[plainIdx];
    if (state !== inMark) {
      flushMark();
      if (state) {
        out += `<mark class="${state === 2 ? MARK_CLASS_CURRENT : MARK_CLASS}">`;
        inMark = state;
      }
    }
    out += item.html;
    plainIdx++;
  }
  flushMark();
  return out;
}
