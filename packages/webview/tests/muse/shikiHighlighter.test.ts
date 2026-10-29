/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  highlightCode,
  highlightFence,
  langFromFence,
  langFromPath,
} from "../../src/utils/shikiHighlighter";

describe("shikiHighlighter", () => {
  it("maps ts to typescript", () => {
    expect(langFromPath("a/b.ts")).toBe("typescript");
  });

  it("highlights typescript with colored spans", async () => {
    const lines = await highlightCode(
      "const a = 1;\n",
      "/work/a.ts",
      true,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("style=\"color:");
    expect(lines[0]).toContain("const");
  });

  it("colors a fenced typescript block", async () => {
    expect(langFromFence("ts")).toBe("typescript");
    expect(langFromFence("mermaid")).toBeNull();
    const html = await highlightFence("const a = 1;", langFromFence("ts"), true);
    expect(html).toContain("style=\"color:");
    expect(html).toContain("const");
  });

  it("falls back to plain text for unsupported langs", async () => {
    const lines = await highlightCode("fn main() {}", "/work/a.rs", true);
    expect(lines[0]).toBe("fn main() {}");
    expect(lines[0]).not.toContain("style=");
  });
});
