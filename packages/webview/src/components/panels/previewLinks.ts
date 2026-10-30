/** Bookmarks and recently opened pages for the preview sidebar. */

export type PreviewLink = {
  url: string;
  title: string;
  visitedAt: number;
};

export type PreviewLibrary = {
  bookmarks: PreviewLink[];
  recents: PreviewLink[];
};

export type PreviewRecentGroup = {
  label: string;
  items: PreviewLink[];
};

const STORAGE_KEY = "muse.preview.library";
const OPEN_KEY = "muse.preview.links-open";
const WIDTH_KEY = "muse.preview.links-width";
const CHANGE_EVENT = "muse-preview-library";
const WIDTH_EVENT = "muse-preview-links-width";

export const PREVIEW_LINKS_WIDTH_MIN = 180;
export const PREVIEW_LINKS_WIDTH_MAX = 420;
export const PREVIEW_LINKS_WIDTH_DEFAULT = 240;

export function clampPreviewLinksWidth(width: number): number {
  return Math.min(PREVIEW_LINKS_WIDTH_MAX, Math.max(PREVIEW_LINKS_WIDTH_MIN, width));
}
const MAX_LINKS = 40;
const DAY = 24 * 60 * 60 * 1000;

const EMPTY: PreviewLibrary = { bookmarks: [], recents: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readLink(value: unknown): PreviewLink | null {
  if (!isRecord(value)) return null;
  if (typeof value.url !== "string" || !value.url) return null;
  return {
    url: value.url,
    title: typeof value.title === "string" ? value.title : "",
    visitedAt: typeof value.visitedAt === "number" ? value.visitedAt : 0,
  };
}

/** `null` means the user has not chosen, so the sidebar stays open. */
export function readPreviewLinksOpen(): boolean | null {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
    return null;
  } catch {
    return null;
  }
}

export function writePreviewLinksOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage can be unavailable in locked-down guests.
  }
}

export function readPreviewLinksWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return PREVIEW_LINKS_WIDTH_DEFAULT;
    return clampPreviewLinksWidth(raw);
  } catch {
    return PREVIEW_LINKS_WIDTH_DEFAULT;
  }
}

export function writePreviewLinksWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(clampPreviewLinksWidth(width)));
    window.dispatchEvent(new Event(WIDTH_EVENT));
  } catch {
    // Storage can be unavailable in locked-down guests.
  }
}

export function subscribePreviewLinksWidth(onChange: () => void): () => void {
  window.addEventListener(WIDTH_EVENT, onChange);
  return () => window.removeEventListener(WIDTH_EVENT, onChange);
}

export function readPreviewLibrary(): PreviewLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return EMPTY;
    const bookmarks = Array.isArray(parsed.bookmarks)
      ? parsed.bookmarks.map(readLink).filter((link): link is PreviewLink => Boolean(link))
      : [];
    const recents = Array.isArray(parsed.recents)
      ? parsed.recents.map(readLink).filter((link): link is PreviewLink => Boolean(link))
      : [];
    return { bookmarks, recents };
  } catch {
    return EMPTY;
  }
}

function writePreviewLibrary(next: PreviewLibrary): PreviewLibrary {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage can be unavailable in locked-down guests.
  }
  return next;
}

export function subscribePreviewLibrary(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function previewLinkTitle(url: string, title?: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      const name = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
      return name || url;
    }
    return parsed.hostname || url;
  } catch {
    return url;
  }
}

function upsert(links: PreviewLink[], link: PreviewLink): PreviewLink[] {
  return [link, ...links.filter((item) => item.url !== link.url)].slice(0, MAX_LINKS);
}

export function recordPreviewVisit(
  url: string,
  title?: string,
  now = Date.now(),
): PreviewLibrary {
  if (!url || url === "about:blank") return readPreviewLibrary();
  const library = readPreviewLibrary();
  const previous = library.recents.find((item) => item.url === url);
  const next = writePreviewLibrary({
    ...library,
    recents: upsert(library.recents, {
      url,
      title: previewLinkTitle(url, title || previous?.title),
      visitedAt: now,
    }),
  });
  return next;
}

export function updatePreviewLinkTitle(url: string, title: string): PreviewLibrary {
  const trimmed = title.trim();
  if (!url || !trimmed) return readPreviewLibrary();
  const library = readPreviewLibrary();
  const rename = (link: PreviewLink) =>
    link.url === url ? { ...link, title: trimmed } : link;
  return writePreviewLibrary({
    bookmarks: library.bookmarks.map(rename),
    recents: library.recents.map(rename),
  });
}

export function isPreviewBookmarked(library: PreviewLibrary, url: string): boolean {
  return library.bookmarks.some((link) => link.url === url);
}

export function togglePreviewBookmark(
  url: string,
  title?: string,
  now = Date.now(),
): PreviewLibrary {
  if (!url || url === "about:blank") return readPreviewLibrary();
  const library = readPreviewLibrary();
  if (isPreviewBookmarked(library, url)) {
    return writePreviewLibrary({
      ...library,
      bookmarks: library.bookmarks.filter((link) => link.url !== url),
    });
  }
  const previous =
    library.bookmarks.find((link) => link.url === url) ||
    library.recents.find((link) => link.url === url);
  return writePreviewLibrary({
    ...library,
    bookmarks: upsert(library.bookmarks, {
      url,
      title: previewLinkTitle(url, title || previous?.title),
      visitedAt: now,
    }),
  });
}

export function removePreviewBookmark(url: string): PreviewLibrary {
  const library = readPreviewLibrary();
  return writePreviewLibrary({
    ...library,
    bookmarks: library.bookmarks.filter((link) => link.url !== url),
  });
}

export function removePreviewRecent(url: string): PreviewLibrary {
  const library = readPreviewLibrary();
  return writePreviewLibrary({
    ...library,
    recents: library.recents.filter((link) => link.url !== url),
  });
}

export function filterPreviewLinks(links: readonly PreviewLink[], query: string): PreviewLink[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...links];
  return links.filter(
    (link) =>
      link.title.toLowerCase().includes(needle) || link.url.toLowerCase().includes(needle),
  );
}

/** Today, yesterday, then the rest of the last week and month. Older visits drop off. */
export function previewRecentGroups(
  recents: readonly PreviewLink[],
  now = Date.now(),
): PreviewRecentGroup[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const buckets: { label: string; from: number; to: number }[] = [
    { label: "今天", from: today, to: Infinity },
    { label: "昨天", from: today - DAY, to: today },
    { label: "最近 7 天", from: today - 7 * DAY, to: today - DAY },
    { label: "最近 30 天", from: today - 30 * DAY, to: today - 7 * DAY },
  ];
  return buckets
    .map((bucket) => ({
      label: bucket.label,
      items: recents.filter(
        (link) => link.visitedAt >= bucket.from && link.visitedAt < bucket.to,
      ),
    }))
    .filter((group) => group.items.length > 0);
}
