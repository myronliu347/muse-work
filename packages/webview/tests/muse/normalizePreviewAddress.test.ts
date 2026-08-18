import { describe, expect, it } from "vitest";
import { normalizePreviewAddress } from "../../src/components/panels/PreviewPane";

describe("normalizePreviewAddress", () => {
  it("adds http:// when protocol is missing", () => {
    expect(normalizePreviewAddress("localhost:5173")).toBe(
      "http://localhost:5173/",
    );
  });

  it("keeps https URLs", () => {
    expect(normalizePreviewAddress("https://example.com/a")).toBe(
      "https://example.com/a",
    );
  });

  it("rejects empty input", () => {
    expect(normalizePreviewAddress("")).toBeNull();
  });

  it("accepts file:// URLs", () => {
    expect(normalizePreviewAddress("file:///tmp/x/index.html")).toBe(
      "file:///tmp/x/index.html",
    );
  });

  it("converts absolute local paths to file:// URLs", () => {
    expect(normalizePreviewAddress("/Users/a/index.html")).toBe(
      "file:///Users/a/index.html",
    );
    expect(normalizePreviewAddress("C:\\web\\index.html")).toBe(
      "file:///C:/web/index.html",
    );
  });
});
