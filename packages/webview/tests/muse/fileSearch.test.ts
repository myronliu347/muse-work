import { describe, it, expect } from "vitest";
import { findMatches, wrapLineMatches } from "../../src/utils/fileSearch";

describe("findMatches", () => {
  it("returns no matches for an empty query", () => {
    expect(findMatches(["const a = 1;"], "")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const lines = ["const a = 1;", "const b = 2;"];
    expect(findMatches(lines, "CONST")).toEqual([
      { lineIndex: 0, startCol: 0, endCol: 5 },
      { lineIndex: 1, startCol: 0, endCol: 5 },
    ]);
  });

  it("finds multiple matches on one line", () => {
    expect(findMatches(["a a a"], "a")).toEqual([
      { lineIndex: 0, startCol: 0, endCol: 1 },
      { lineIndex: 0, startCol: 2, endCol: 3 },
      { lineIndex: 0, startCol: 4, endCol: 5 },
    ]);
  });

  it("returns nothing when the query is absent", () => {
    expect(findMatches(["const a = 1;"], "xyz")).toEqual([]);
  });

  it("returns nothing when the query is longer than any line", () => {
    expect(findMatches(["ab"], "abc")).toEqual([]);
  });

  it("returns no matches on empty lines", () => {
    expect(findMatches(["", "foo"], "foo")).toEqual([
      { lineIndex: 1, startCol: 0, endCol: 3 },
    ]);
  });
});

describe("wrapLineMatches", () => {
  const MARK = '<mark class="file-pane-search-mark">';
  const close = "</mark>";

  it("wraps a plain-text match", () => {
    expect(wrapLineMatches("const a = 1;", "const a = 1;", [{ start: 6, end: 7 }]))
      .toBe(`const ${MARK}a${close} = 1;`);
  });

  it("wraps inside a syntax span, preserving the span", () => {
    expect(
      wrapLineMatches(
        'const <span style="color:#ff0000">a</span> = 1;',
        "const a = 1;",
        [{ start: 6, end: 7 }],
      ),
    ).toBe(
      `const <span style="color:#ff0000">${MARK}a${close}</span> = 1;`,
    );
  });

  it("escapes special characters in the matched text", () => {
    expect(
      wrapLineMatches("a &lt; b", "a < b", [{ start: 2, end: 5 }]),
    ).toBe(`a ${MARK}&lt; b${close}`);
  });

  it("wraps a match that spans span boundaries", () => {
    const html =
      '<span style="color:#1">con</span><span style="color:#2">st</span> = 42';
    expect(wrapLineMatches(html, "const = 42", [{ start: 0, end: 5 }])).toBe(
      `<span style="color:#1">${MARK}con${close}</span><span style="color:#2">${MARK}st${close}</span> = 42`,
    );
  });

  it("ignores query-like text inside tag attributes", () => {
    // attribute "shiki-a" contains "a", but the match must land on the
    // trailing plain "a" (line 6), not inside the tag
    expect(
      wrapLineMatches('<span class="shiki-a">const</span> a', "const a", [
        { start: 6, end: 7 },
      ]),
    ).toBe(`<span class="shiki-a">const</span> ${MARK}a${close}`);
  });

  it("marks the active match with a distinct class", () => {
    expect(
      wrapLineMatches(
        "a b a",
        "a b a",
        [
          { start: 0, end: 1 },
          { start: 4, end: 5 },
        ],
        { start: 4, end: 5 },
      ),
    ).toBe(
      `<mark class="file-pane-search-mark">a</mark> b <mark class="file-pane-search-mark file-pane-search-mark--current">a</mark>`,
    );
  });

  it("does nothing when there are no matches", () => {
    expect(wrapLineMatches("const a = 1;", "const a = 1;", [])).toBe(
      "const a = 1;",
    );
  });

  it("handles an empty line", () => {
    expect(wrapLineMatches("", "", [])).toBe("");
  });
});
