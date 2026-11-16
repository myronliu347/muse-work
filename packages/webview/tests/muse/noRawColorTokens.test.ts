import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Files that own raw palette values for a reason. */
const CSS_ALLOW = new Set([
  "styles/tokens.css",
  "styles/globals.css",
  "styles/AppearanceSettings.css",
  "styles/TerminalPane.css",
]);
const TS_ALLOW = new Set([
  "components/panels/TerminalPane.tsx",
  "components/panels/PreviewPane.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function cssViolations(file: string, text: string): string[] {
  const hits: string[] = [];
  const lines = stripComments(text).split("\n");
  const rawStatus = /var\(--(?:red|green|amber|orange|blue)-[0-9]+/;
  const rawGray = /var\(--gray-[0-9]+/;
  const rawAccent = /var\(--accent-(?:[0-9]+|a[0-9]+|contrast)/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const where = `${rel(file)}:${i + 1}`;
    const prop = line.match(/^\s*([a-z-]+)\s*:/)?.[1];
    if (prop === "color" && rawGray.test(line))
      hits.push(`${where} raw text color — use --text-*`);
    if (
      prop !== "color" &&
      (prop?.startsWith("background") || prop === "box-shadow") &&
      (rawGray.test(line) || /var\(--color-[a-z]+/.test(line))
    )
      hits.push(`${where} raw surface — use --surface-*`);
    if (prop?.startsWith("border") && rawGray.test(line))
      hits.push(`${where} raw border — use --border-*`);
    if (rawStatus.test(line))
      hits.push(`${where} raw status color — use --status-*`);
    if (rawAccent.test(line))
      hits.push(`${where} raw accent primitive — use --accent-decorative/-text/-soft`);
    const rawRgba = line
      .replace(/rgba\(0, 0, 0, 0\)/g, "")
      .match(/rgba?\([^)]*\)/);
    if (
      rawRgba &&
      (prop === "box-shadow" || prop?.startsWith("background"))
    ) {
      hits.push(`${where} raw shadow/overlay — use --shadow-* / --overlay-*`);
    }
    const withoutCanvasFallback = line.replace(
      /var\(--surface-canvas, #111111\)/g,
      "",
    );
    if (
      (prop === "color" ||
        prop === "box-shadow" ||
        prop?.startsWith("background") ||
        prop?.startsWith("border")) &&
      /#[0-9a-fA-F]{3,8}\b/.test(withoutCanvasFallback)
    ) {
      hits.push(`${where} raw hex — use a semantic token`);
    }
  }
  return hits;
}

function tsViolations(file: string, text: string): string[] {
  const hits: string[] = [];
  const lines = stripComments(text).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const where = `${rel(file)}:${i + 1}`;
    if (/var\(--(?:gray-[0-9]+|red-[0-9]+|green-[0-9]+|amber-[0-9]+|orange-[0-9]+|blue-[0-9]+|accent-(?:[0-9]+|a[0-9]+|contrast))/.test(line))
      hits.push(`${where} raw token var — use semantic tokens`);
    if (/#[0-9a-fA-F]{3,8}\b/.test(line))
      hits.push(`${where} raw hex — use semantic tokens`);
  }
  return hits;
}

describe("color token contract", () => {
  const files = walk(SRC);

  it("keeps CSS on semantic text/surface/border/shadow tokens", () => {
    const violations = files
      .filter((f) => f.endsWith(".css") && !CSS_ALLOW.has(rel(f)))
      .flatMap((f) => cssViolations(f, readFileSync(f, "utf8")));
    expect(violations).toEqual([]);
  });

  it("keeps TSX/TS inline styles on semantic tokens", () => {
    const violations = files
      .filter(
        (f) =>
          (f.endsWith(".tsx") || f.endsWith(".ts")) && !TS_ALLOW.has(rel(f)),
      )
      .flatMap((f) => tsViolations(f, readFileSync(f, "utf8")));
    expect(violations).toEqual([]);
  });
});
