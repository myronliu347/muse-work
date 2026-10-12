import { decodeFileHref } from "../../utils/filePathDisplay";

export type AssistantLinkTarget =
  | { kind: "file"; path: string; startLine?: number; endLine?: number }
  | { kind: "browser"; url: string }
  | { kind: "external"; url: string };

/** File paths open the file panel. http(s) opens the browser panel. */
export function classifyAssistantHref(href: string): AssistantLinkTarget | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^file:/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      let path = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
      return path ? { kind: "file", path } : null;
    } catch {
      return null;
    }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    if (/^https?:/i.test(trimmed)) return { kind: "browser", url: trimmed };
    return { kind: "external", url: trimmed };
  }
  const decoded = decodeFileHref(trimmed);
  const lined = decoded.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (lined && lined[1]) {
    return {
      kind: "file",
      path: lined[1],
      startLine: Number(lined[2]),
      endLine: lined[3] ? Number(lined[3]) : undefined,
    };
  }
  return { kind: "file", path: decoded };
}
