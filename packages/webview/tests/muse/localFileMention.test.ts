/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  fileItemFromAbsolutePath,
  isImageFileName,
  parseClipboardLocalFiles,
  parseFileUriList,
} from "../../src/utils/localFileMention";

describe("localFileMention", () => {
  it("isImageFileName matches common image extensions", () => {
    expect(isImageFileName("a.PNG")).toBe(true);
    expect(isImageFileName("b.ts")).toBe(false);
  });

  it("fileItemFromAbsolutePath uses relative path under workdir", () => {
    const item = fileItemFromAbsolutePath("/proj/src/a.ts", "/proj");
    expect(item).toMatchObject({
      path: "/proj/src/a.ts",
      relativePath: "src/a.ts",
      name: "a.ts",
      isDirectory: false,
      extension: "ts",
    });
    expect(item.icon).toBeTruthy();
  });

  it("fileItemFromAbsolutePath keeps absolute path outside workdir", () => {
    const item = fileItemFromAbsolutePath("/tmp/out.md", "/proj");
    expect(item.relativePath).toBe("/tmp/out.md");
    expect(item.name).toBe("out.md");
  });

  it("parseFileUriList decodes file:// URIs", () => {
    expect(
      parseFileUriList("file:///tmp/a.ts\nfile:///tmp/b%20c.md\nhttps://x"),
    ).toEqual(["/tmp/a.ts", "/tmp/b c.md"]);
  });

  it("parseClipboardLocalFiles prefers File.path and skips directory-looking paths", () => {
    const file = new File([""], "note.md", { type: "text/markdown" });
    Object.defineProperty(file, "path", { value: "/tmp/note.md" });
    const dt = {
      items: [
        {
          kind: "file",
          type: "text/markdown",
          getAsFile: () => file,
        },
      ],
      files: [file],
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(parseClipboardLocalFiles(dt)).toEqual([
      { absolutePath: "/tmp/note.md", file, isImage: false },
    ]);

    const dirPath = "/tmp/folder/";
    const uriDt = {
      items: [],
      files: [],
      types: ["text/uri-list"],
      getData: (t: string) => (t === "text/uri-list" ? `file://${dirPath}` : ""),
    } as unknown as DataTransfer;
    expect(parseClipboardLocalFiles(uriDt)).toEqual([]);
  });

  it("parseClipboardLocalFiles uses museGetPathForFile when File.path is absent", () => {
    const file = new File([""], "note.md", { type: "text/markdown" });
    const g = globalThis as typeof globalThis & {
      museGetPathForFile?: (f: File) => string;
    };
    const prev = g.museGetPathForFile;
    g.museGetPathForFile = () => "/proj/note.md";
    try {
      const dt = {
        files: [file],
        types: ["Files"],
        getData: () => "",
      } as unknown as DataTransfer;
      expect(parseClipboardLocalFiles(dt)).toEqual([
        { absolutePath: "/proj/note.md", file, isImage: false },
      ]);
    } finally {
      g.museGetPathForFile = prev;
    }
  });
});
