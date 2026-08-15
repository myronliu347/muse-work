import { createHighlighter, type Highlighter } from "shiki/bundle/web";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

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
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  rb: "ruby",
  php: "php",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  toml: "toml",
  ini: "ini",
  diff: "diff",
  patch: "diff",
  proto: "proto",
  vue: "vue",
  svelte: "svelte",
};

export function getShikiTheme(dark: boolean): "github-dark" | "github-light" {
  return dark ? "github-dark" : "github-light";
}

export function langFromPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  if (/^makefile$/i.test(base)) return "makefile";
  const ext = (base.includes(".") ? base.split(".").pop() : "")?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "txt";
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [
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
        "go",
        "rust",
        "c",
        "cpp",
        "csharp",
        "bash",
        "sql",
        "ruby",
        "php",
        "kotlin",
        "swift",
        "toml",
        "ini",
        "diff",
        "proto",
        "vue",
        "svelte",
        "dockerfile",
        "makefile",
        "txt",
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

/**
 * Split highlighted HTML into per-line fragments with balanced spans so
 * multi-line tokens do not leak across line boundaries.
 */
export function splitHighlightedHtml(html: string): string[] {
  const lines: string[] = [];
  const stack: string[] = [];
  let current = "";
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!part) continue;
    if (part === "\n") {
      lines.push(current + stack.map(() => "</span>").join(""));
      current = stack.join("");
      continue;
    }
    if (part === "</span>") {
      current += part;
      stack.pop();
      continue;
    }
    if (part.startsWith("<span")) {
      current += part;
      stack.push(part);
      continue;
    }
    current += part;
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Highlight file content; returns per-line HTML fragments. */
export async function highlightCode(
  code: string,
  filePath: string,
  dark: boolean,
): Promise<string[]> {
  const raw = code.replace(/\n$/, "");
  const lang = langFromPath(filePath);
  const theme = getShikiTheme(dark);
  try {
    const highlighter = await getHighlighter();
    const loaded = highlighter.getLoadedLanguages();
    const useLang = loaded.includes(lang as never) ? lang : "txt";
    const html = highlighter.codeToHtml(raw, {
      lang: useLang,
      theme,
    });
    // Strip outer <pre><code>…</code></pre>
    const inner = html
      .replace(/^<pre[^>]*>\s*<code[^>]*>/, "")
      .replace(/<\/code>\s*<\/pre>$/, "");
    return splitHighlightedHtml(inner);
  } catch {
    return escapeHtml(raw).split("\n");
  }
}
