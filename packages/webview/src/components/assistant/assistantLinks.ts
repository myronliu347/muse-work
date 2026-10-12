import { decodeFileHref } from "../../utils/filePathDisplay";
import { linkifyFilePaths } from "../../utils/messageUtils";

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

/** File paths linkify would turn into file-panel links, without the :line suffix. */
export function collectAssistantFilePaths(markdown: string): string[] {
  const linked = linkifyFilePaths(markdown);
  const paths: string[] = [];
  const seen = new Set<string>();
  const re = /\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(linked))) {
    const target = classifyAssistantHref(match[1]);
    if (target?.kind !== "file" || seen.has(target.path)) continue;
    seen.add(target.path);
    paths.push(target.path);
  }
  return paths;
}

/** Drop file links the host says cannot be opened. The label stays as text. */
export function stripClosedFileLinks(
  html: string,
  closed: ReadonlySet<string>,
): string {
  if (!html || closed.size === 0) return html;
  return html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/g,
    (whole, attrs: string, inner: string) => {
      const href = /href="([^"]*)"/.exec(attrs)?.[1];
      if (!href) return whole;
      const target = classifyAssistantHref(href);
      if (target?.kind === "file" && closed.has(target.path)) return inner;
      return whole;
    },
  );
}
