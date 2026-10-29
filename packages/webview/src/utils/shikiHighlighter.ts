import {
  createHighlighter,
  bundledLanguages,
  type Highlighter,
  type BundledLanguage,
} from "shiki/bundle/web";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** Extension → shiki lang id (only ids present in shiki/bundle/web). */
const EXT_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "jsonc",
  html: "html",
  htm: "html",
  svg: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  php: "php",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql",
  gql: "graphql",
};

const WEB_LANGS = new Set(Object.keys(bundledLanguages));

/** Subset we preload — every id must exist in the web bundle. */
const PRELOAD_LANGS = (
  [
    "javascript",
    "jsx",
    "typescript",
    "tsx",
    "json",
    "jsonc",
    "html",
    "xml",
    "css",
    "scss",
    "less",
    "yaml",
    "markdown",
    "python",
    "java",
    "c",
    "cpp",
    "bash",
    "sql",
    "php",
    "vue",
    "svelte",
    "graphql",
  ] as BundledLanguage[]
).filter((l) => WEB_LANGS.has(l));

export function getShikiTheme(dark: boolean): "github-dark" | "github-light" {
  return dark ? "github-dark" : "github-light";
}

export function langFromPath(filePath: string): BundledLanguage | null {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const ext =
    (base.includes(".") ? base.split(".").pop() : "")?.toLowerCase() ?? "";
  const mapped = EXT_LANG[ext];
  if (mapped && WEB_LANGS.has(mapped)) return mapped as BundledLanguage;
  return null;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: PRELOAD_LANGS,
      engine: createJavaScriptRegexEngine(),
    }).catch((err) => {
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Fence info string (`ts`, `typescript`) → a bundled shiki language. */
export function langFromFence(info: string | null | undefined): BundledLanguage | null {
  const id = info?.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (!id || id === "mermaid") return null;
  const mapped = EXT_LANG[id] ?? id;
  if (WEB_LANGS.has(mapped)) return mapped as BundledLanguage;
  return null;
}

function lineHtml(line: { content: string; color?: string }[]): string {
  return line
    .map((token) => {
      const text = escapeHtml(token.content);
      return token.color ? `<span style="color:${token.color}">${text}</span>` : text;
    })
    .join("");
}

/** Highlight file content; returns per-line HTML fragments (inline-colored spans). */
export async function highlightCode(
  code: string,
  filePath: string,
  dark: boolean,
): Promise<string[]> {
  const raw = code.replace(/\n$/, "");
  const plain = () => escapeHtml(raw).split("\n");
  const lang = langFromPath(filePath);
  if (!lang) return plain();

  const theme = getShikiTheme(dark);
  try {
    const highlighter = await getHighlighter();
    const result = highlighter.codeToTokens(raw, { lang, theme });
    return result.tokens.map((line) => lineHtml(line));
  } catch {
    return plain();
  }
}

/** Inner HTML for one fenced code block. Null when the language is unknown. */
export async function highlightFence(
  code: string,
  lang: BundledLanguage | null,
  dark: boolean,
): Promise<string | null> {
  if (!lang) return null;
  const theme = getShikiTheme(dark);
  try {
    const highlighter = await getHighlighter();
    const result = highlighter.codeToTokens(code.replace(/\n$/, ""), { lang, theme });
    return result.tokens.map((line) => lineHtml(line)).join("\n");
  } catch {
    return null;
  }
}
