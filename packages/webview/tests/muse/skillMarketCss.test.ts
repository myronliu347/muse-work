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
    expect(css).toContain("height: 24px");
    expect(css).toContain("translateX(100%)");
    expect(css).toContain("border-radius: 12px");
    expect(css).toContain("var(--action-primary-bg)");
    expect(css).toContain("var(--action-primary-fg)");
    expect(css).toContain("var(--text-primary)");
    expect(css).toContain("var(--text-secondary)");
    expect(css).toContain("var(--status-danger-text)");
    expect(css).toContain("var(--hairline)");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
