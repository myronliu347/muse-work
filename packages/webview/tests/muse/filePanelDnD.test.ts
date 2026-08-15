import { describe, expect, it } from "vitest";
import {
  encodeFileSelectionClipboard,
  encodeFileTreeDrag,
  parseFileSelectionClipboard,
  parseFileTreeDrag,
} from "../../src/utils/filePanelDnD";

describe("filePanelDnD", () => {
  it("round-trips tree drag payload", () => {
    const payload = {
      path: "/w/a.ts",
      relativePath: "a.ts",
      name: "a.ts",
      isDirectory: false,
    };
    expect(parseFileTreeDrag(encodeFileTreeDrag(payload))).toEqual(payload);
  });

  it("rejects invalid tree drag json", () => {
    expect(parseFileTreeDrag("{")).toBeNull();
    expect(parseFileTreeDrag("{}")).toBeNull();
  });

  it("round-trips selection clipboard payload", () => {
    const payload = {
      filePath: "/w/ChatApp.tsx",
      fileName: "ChatApp.tsx",
      startLine: 127,
      endLine: 146,
      text: "code",
    };
    expect(
      parseFileSelectionClipboard(encodeFileSelectionClipboard(payload)),
    ).toEqual(payload);
  });
});
