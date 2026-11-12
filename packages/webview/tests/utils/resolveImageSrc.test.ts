import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFilesystemImagePath,
  resolveImageSrc,
} from "../../src/utils/resolveImageSrc";

describe("resolveImageSrc", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("detects filesystem refs", () => {
    expect(isFilesystemImagePath("/tmp/muse-work/uploads/a.png")).toBe(true);
    expect(isFilesystemImagePath("C:\\tmp\\a.png")).toBe(true);
    expect(isFilesystemImagePath("data:image/png;base64,aa")).toBe(false);
  });

  it("passes paint-ready refs through untouched", () => {
    expect(resolveImageSrc("data:image/png;base64,aa")).toBe(
      "data:image/png;base64,aa",
    );
    expect(resolveImageSrc("https://example.test/a.png")).toBe(
      "https://example.test/a.png",
    );
    expect(resolveImageSrc("file:///tmp/a.png")).toBe("file:///tmp/a.png");
  });

  it("turns a filesystem path into a file: URL", () => {
    expect(resolveImageSrc("/tmp/muse-work/uploads/shot.png")).toBe(
      "file:///tmp/muse-work/uploads/shot.png",
    );
    expect(resolveImageSrc("C:\\tmp\\shot.png")).toBe("file:///C:/tmp/shot.png");
  });

  it("never fetches a file: URL from the renderer", () => {
    // The webview CSP has no `file:` in connect-src, so a fetch here can only
    // fail — it used to log a violation per thumbnail.
    const fetchSpy = vi.fn(() => Promise.reject(new Error("blocked")));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    expect(resolveImageSrc("/tmp/muse-work/uploads/shot.png")).toBe(
      "file:///tmp/muse-work/uploads/shot.png",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
