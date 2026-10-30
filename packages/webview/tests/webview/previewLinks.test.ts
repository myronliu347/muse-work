/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clampPreviewLinksWidth,
  filterPreviewLinks,
  previewRecentGroups,
  readPreviewLibrary,
  readPreviewLinksWidth,
  recordPreviewVisit,
  removePreviewRecent,
  togglePreviewBookmark,
  updatePreviewLinkTitle,
  PREVIEW_LINKS_WIDTH_MAX,
  PREVIEW_LINKS_WIDTH_MIN,
} from "../../src/components/panels/previewLinks";

const DAY = 24 * 60 * 60 * 1000;

describe("previewLinks", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("groups recent visits and drops anything older than 30 days", () => {
    const now = new Date(2026, 9, 30, 12).getTime();
    recordPreviewVisit("https://today.example", "今天的", now);
    recordPreviewVisit("https://yesterday.example", "昨天的", now - DAY);
    recordPreviewVisit("https://week.example", "这周的", now - 3 * DAY);
    recordPreviewVisit("https://month.example", "这个月的", now - 10 * DAY);
    recordPreviewVisit("https://old.example", "太旧", now - 40 * DAY);

    const groups = previewRecentGroups(readPreviewLibrary().recents, now);
    expect(groups.map((group) => group.label)).toEqual([
      "今天",
      "昨天",
      "最近 7 天",
      "最近 30 天",
    ]);
    expect(groups[0]?.items[0]?.title).toBe("今天的");
    expect(groups.flatMap((group) => group.items.map((item) => item.url))).not.toContain(
      "https://old.example",
    );
  });

  it("toggles a bookmark and keeps the page title", () => {
    recordPreviewVisit("file:///tmp/report.html");
    expect(readPreviewLibrary().recents[0]?.title).toBe("report.html");

    togglePreviewBookmark("https://a.example/path");
    expect(readPreviewLibrary().bookmarks[0]?.title).toBe("a.example");
    updatePreviewLinkTitle("https://a.example/path", "文档");
    expect(readPreviewLibrary().bookmarks[0]?.title).toBe("文档");
    togglePreviewBookmark("https://a.example/path");
    expect(readPreviewLibrary().bookmarks).toEqual([]);
  });

  it("moves a repeat visit to the front without dropping its title", () => {
    recordPreviewVisit("https://a.example", "A", 1);
    recordPreviewVisit("https://b.example", "B", 2);
    recordPreviewVisit("https://a.example", "", 3);
    const recents = readPreviewLibrary().recents;
    expect(recents.map((link) => link.url)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(recents[0]?.title).toBe("A");
    expect(recents[0]?.visitedAt).toBe(3);
  });

  it("removes one recent visit and clamps the sidebar width", () => {
    recordPreviewVisit("https://a.example", "A", 1);
    recordPreviewVisit("https://b.example", "B", 2);
    removePreviewRecent("https://a.example");
    expect(readPreviewLibrary().recents.map((link) => link.url)).toEqual(["https://b.example"]);
    expect(clampPreviewLinksWidth(10)).toBe(PREVIEW_LINKS_WIDTH_MIN);
    expect(clampPreviewLinksWidth(900)).toBe(PREVIEW_LINKS_WIDTH_MAX);
    expect(readPreviewLinksWidth()).toBe(240);
  });

  it("filters by title or url", () => {
    const links = [
      { url: "https://a.example", title: "报告", visitedAt: 1 },
      { url: "file:///tmp/other.html", title: "other.html", visitedAt: 2 },
    ];
    expect(filterPreviewLinks(links, "报告").map((link) => link.url)).toEqual([
      "https://a.example",
    ]);
    expect(filterPreviewLinks(links, "OTHER").map((link) => link.url)).toEqual([
      "file:///tmp/other.html",
    ]);
  });
});
