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
    return result.tokens.map((line) =>
      line
        .map((token) => {
          const color = token.color;
          const text = escapeHtml(token.content);
          return color
            ? `<span style="color:${color}">${text}</span>`
            : text;
        })
        .join(""),
    );
  } catch {
    return plain();
  }
}
