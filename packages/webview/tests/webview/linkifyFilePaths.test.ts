import { describe, it, expect } from "vitest";
import { linkifyFilePaths } from "../../src/utils/messageUtils";

describe("linkifyFilePaths", () => {
  it("wraps a relative path with slash + extension into a markdown link", () => {
    expect(linkifyFilePaths("see src/foo.ts now")).toBe(
      "see [src/foo.ts](src/foo.ts) now",
    );
  });

  it("wraps an absolute path", () => {
    expect(linkifyFilePaths("open /Users/me/repo/src/index.ts please")).toBe(
      "open [/Users/me/repo/src/index.ts](/Users/me/repo/src/index.ts) please",
    );
  });

  it("wraps ./ ../ and ~/ prefixed paths", () => {
    expect(linkifyFilePaths("a ./config.ts b")).toBe(
      "a [./config.ts](./config.ts) b",
    );
    expect(linkifyFilePaths("a ../lib/util.ts b")).toBe(
      "a [../lib/util.ts](../lib/util.ts) b",
    );
    expect(linkifyFilePaths("a ~/dotfiles/aliases.sh b")).toBe(
      "a [~/dotfiles/aliases.sh](~/dotfiles/aliases.sh) b",
    );
  });

  it("keeps a :line suffix inside the link href", () => {
    expect(linkifyFilePaths("bug at src/foo.ts:12")).toBe(
      "bug at [src/foo.ts:12](src/foo.ts:12)",
    );
  });

  it("keeps a :line:col suffix inside the link href", () => {
    expect(linkifyFilePaths("bug at src/foo.ts:12:34")).toBe(
      "bug at [src/foo.ts:12:34](src/foo.ts:12:34)",
    );
  });

  it("does not link a bare word without a slash", () => {
    expect(linkifyFilePaths("run version.ts now")).toBe("run version.ts now");
  });

  it("links a bare file name with extension in an inline code span", () => {
    expect(linkifyFilePaths("open `version.ts` now")).toBe(
      "open [version.ts](version.ts) now",
    );
    expect(linkifyFilePaths("see `package.json` here")).toBe(
      "see [package.json](package.json) here",
    );
  });

  it("does not link a bare file name when it follows a command verb", () => {
    expect(linkifyFilePaths("run version.ts now")).toBe("run version.ts now");
    expect(linkifyFilePaths("edit README.md")).toBe("edit README.md");
    expect(linkifyFilePaths("open config.json please")).toBe(
      "open config.json please",
    );
  });

  it("links a bare file name in running text (not a command verb)", () => {
    expect(linkifyFilePaths("the bug is in version.ts now")).toBe(
      "the bug is in [version.ts](version.ts) now",
    );
    expect(linkifyFilePaths("please fix version.ts.")).toBe(
      "please fix [version.ts](version.ts).",
    );
  });

  it("does not link common words or decimals that look like files", () => {
    expect(linkifyFilePaths("e.g. this is fine")).toBe("e.g. this is fine");
    expect(linkifyFilePaths("about 3.14 seconds")).toBe("about 3.14 seconds");
    expect(linkifyFilePaths("see page1.5 here")).toBe("see page1.5 here");
    expect(linkifyFilePaths("v1.2.3 released")).toBe("v1.2.3 released");
  });

  it("does not link paths without a file extension (directories)", () => {
    expect(linkifyFilePaths("/Users/liuyuyang/Documents/projects/exams")).toBe(
      "/Users/liuyuyang/Documents/projects/exams",
    );
    expect(linkifyFilePaths("/Users/me/repo/src")).toBe("/Users/me/repo/src");
    expect(linkifyFilePaths("a /tmp b")).toBe("a /tmp b");
  });

  it("does not link URLs", () => {
    expect(linkifyFilePaths("see http://example.com/a.ts now")).toBe(
      "see http://example.com/a.ts now",
    );
    expect(linkifyFilePaths("see https://example.com/a.ts now")).toBe(
      "see https://example.com/a.ts now",
    );
  });

  it("does not touch an existing markdown link target", () => {
    expect(linkifyFilePaths("see [text](src/foo.ts) end")).toBe(
      "see [text](src/foo.ts) end",
    );
  });

  it("leaves fenced code blocks untouched", () => {
    const md = "before\n```\nconst x = require('./src/foo.ts')\n```\nafter";
    expect(linkifyFilePaths(md)).toBe(md);
  });

  it("turns an inline code span path into a link", () => {
    expect(linkifyFilePaths("open `src/foo.ts` now")).toBe(
      "open [src/foo.ts](src/foo.ts) now",
    );
  });

  it("leaves inline code that is not a path untouched", () => {
    expect(linkifyFilePaths("run `foo` now")).toBe("run `foo` now");
  });

  it("drops trailing punctuation from the link", () => {
    expect(linkifyFilePaths("see src/foo.ts.")).toBe(
      "see [src/foo.ts](src/foo.ts).",
    );
    expect(linkifyFilePaths("see src/foo.ts。")).toBe(
      "see [src/foo.ts](src/foo.ts)。",
    );
  });

  it("links a path inside parentheses", () => {
    expect(linkifyFilePaths("(see src/foo.ts)")).toBe(
      "(see [src/foo.ts](src/foo.ts))",
    );
  });

  it("links multiple paths in one line", () => {
    expect(linkifyFilePaths("a src/foo.ts and src/bar.ts")).toBe(
      "a [src/foo.ts](src/foo.ts) and [src/bar.ts](src/bar.ts)",
    );
  });

  it("does not link paths with brackets/parens in the name", () => {
    expect(linkifyFilePaths("open src/a[b].ts")).toBe("open src/a[b].ts");
    expect(linkifyFilePaths("open src/a(b).ts")).toBe("open src/a(b).ts");
  });
});
