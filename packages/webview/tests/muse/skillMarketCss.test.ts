import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SkillsPage.css", () => {
  const css = readFileSync(
    new URL("../../src/styles/SkillsPage.css", import.meta.url),
    "utf8",
  );

  it("uses the existing page metrics and no hex colors", () => {
    expect(css).toContain("max-width: 860px");
    expect(css).toContain("min-height: 38px");
    expect(css).toContain("font-size: 22px");
    expect(css).toContain("font-weight: 650");
    expect(css).toContain("border-radius: 12px");
    expect(css).toContain("var(--accent-9)");
    expect(css).toContain("var(--accent-contrast)");
    expect(css).toContain("var(--gray-12)");
    expect(css).toContain("var(--gray-11)");
    expect(css).toContain("var(--red-9)");
    expect(css).toContain("var(--red-11)");
    expect(css).toContain("var(--hairline)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
