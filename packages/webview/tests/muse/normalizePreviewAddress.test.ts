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

  it("rejects empty and non-http schemes", () => {
    expect(normalizePreviewAddress("")).toBeNull();
    expect(normalizePreviewAddress("file:///tmp/x")).toBeNull();
  });
});
