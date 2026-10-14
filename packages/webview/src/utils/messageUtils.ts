import { AttachedImage } from "../types";

export type MentionIssue = { id: string; title: string };

export function issueMentionLabel(title: string): string {
  const cleaned = title.replace(/[\[\]\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Issue";
}

export function issueMentionToken(issue: MentionIssue): string {
  return `[@issue:${issue.id} ${issueMentionLabel(issue.title)}]`;
}

export function filterMentionIssues(
  issues: MentionIssue[],
  filter: string,
): MentionIssue[] {
  const query = filter.trim().toLowerCase();
  const matched = query
    ? issues.filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          issue.id.toLowerCase().includes(query),
      )
    : issues;
  return matched.slice(0, 20);
}

/**
 * 将 contenteditable 的内容转换为 Markdown 格式，并提取图片。
 *
 * 假设 contenteditable 中的标签使用特定的 HTML 结构，例如：
 * <span class="context-tag" data-path="..." data-name="..." data-icon="..." data-is-image="...">...</span>
 */
export const convertToMarkdown = (
  container: HTMLElement,
): { markdown: string; images: AttachedImage[] } => {
  let markdown = "";
  const images: AttachedImage[] = [];

  const traverse = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      markdown += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;

      // Skip the read-only "编辑队列消息" chip: it's only a state marker and must
      // not be included in the produced markdown.
      if (element.classList.contains("queued-edit-chip")) {
        return;
      }

      // Check if it's a context tag container
      if (element.classList.contains("context-tag-container")) {
        const path = element.getAttribute("data-path") || "";
        const isImage = element.getAttribute("data-is-image") === "true";
        const isSelection =
          element.getAttribute("data-is-selection") === "true";
        const imageUrl = element.getAttribute("data-image-url");

        const issueId = element.getAttribute("data-issue-id");
        if (issueId) {
          markdown += issueMentionToken({
            id: issueId,
            title: element.getAttribute("data-name") || "",
          });
          return;
        }

        if (isImage && imageUrl) {
          const placeholder = `[image${images.length + 1}]`;
          markdown += placeholder;
          images.push({
            id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            data: imageUrl,
            mimeType: imageUrl.split(";")[0].split(":")[1] || "image/png",
            filename: element.getAttribute("data-name") || "pasted-image.png",
          });
        } else if (isSelection) {
          const name = element.getAttribute("data-name") || "";
          const startLine = element.getAttribute("data-start-line") || "";
          const endLine = element.getAttribute("data-end-line") || "";
          markdown += `[Selection: ${path}|${name}#${startLine}-${endLine}]`;
        } else {
          markdown += `[@file:${path}]`;
        }
        return; // Important: don't traverse children
      }

      if (element.tagName === "BR") {
        markdown += "\n";
      } else {
        // For other elements, traverse children
        Array.from(element.childNodes).forEach(traverse);

        // If it's a block element, ensure it ends with a newline
        const isBlock = [
          "DIV",
          "P",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "LI",
          "UL",
          "OL",
        ].includes(element.tagName);
        if (isBlock) {
          if (markdown.length > 0 && !markdown.endsWith("\n")) {
            markdown += "\n";
          }
        }
      }
    }
  };

  // Use a more robust way to get content from contenteditable
  // We'll traverse the actual DOM nodes
  Array.from(container.childNodes).forEach(traverse);

  return { markdown: markdown.trim(), images };
};

/**
 * 剥离服务端追加的 [Image source: <path>] 标记——该标记仅供模型读取磁盘路径，
 * 不希望在用户消息渲染中显示或转成链接。连续多个标记（含中间换行）整体移除。
 */
export const stripImageSourceMarkers = (text: string): string =>
  text.replace(/\[Image source: [^\]]+\](\n\[Image source: [^\]]+\])*/g, "");

/**
 * Normalize user text for optimistic ↔ SDK echo dedupe. Slash-skill paths
 * rebuild `/${name} ${args.trim()}` which can collapse runs of spaces that
 * contenteditable / convertToMarkdown left in the optimistic bubble.
 */
export const normalizeUserTextForDedupe = (text: string): string =>
  text.trim().replace(/\s+/g, " ");

/**
 * 解析 Markdown 中的标签语法 [@issue:id 标题]、[@file:path]、[Selection: fileName#start-end] 和 [imageN]
 */
export const parseMentions = (
  text: string,
  attachedImages?: Array<{ data: string; filename?: string }>,
): Array<{
  type: "text" | "mention" | "selection";
  content: string;
  path?: string;
  isImage?: boolean;
  fileName?: string;
  startLine?: string;
  endLine?: string;
  imageData?: string;
  issueId?: string;
}> => {
  text = stripImageSourceMarkers(text);
  const parts: Array<{
    type: "text" | "mention" | "selection";
    content: string;
    path?: string;
    isImage?: boolean;
    fileName?: string;
    startLine?: string;
    endLine?: string;
    imageData?: string;
    issueId?: string;
  }> = [];
  const regex =
    /\[@issue:([^\s\]]+)(?:\s+([^\]]*))?\]|\[@file:(.*?)\]|\[Selection: (?:(.*?)\|)?(.*?)#(\d+)-(\d+)\]|\[image(\d+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: text.substring(lastIndex, match.index),
      });
    }

    if (match[1]) {
      parts.push({
        type: "mention",
        content: match[0],
        issueId: match[1],
        fileName: match[2]?.trim() || match[1],
      });
    } else if (match[3]) {
      const path = match[3];
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path);
      parts.push({ type: "mention", content: match[0], path, isImage });
    } else if (match[8]) {
      const index = parseInt(match[8]) - 1;
      const attachedImage = attachedImages?.[index];
      const displayName = `图片 ${match[8]}`;
      parts.push({
        type: "mention",
        content: match[0],
        path: displayName,
        isImage: true,
        imageData: attachedImage?.data,
      });
    } else if (match[5]) {
      parts.push({
        type: "selection",
        content: match[0],
        path: match[4],
        fileName: match[5],
        startLine: match[6],
        endLine: match[7],
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.substring(lastIndex) });
  }

  return parts;
};

/**
 * Render a tool file path relative to the agent workdir for compact display,
 * e.g. /home/user/repo/src/index.ts → src/index.ts. Falls back to the original
 * absolute path when no workdir is known or the path is outside it. The
 * original (absolute) path is always used for open-file jumps.
 */
export const toRelativePath = (filePath: string, workdir?: string): string => {
  if (!filePath || !workdir) return filePath;
  // Normalize trailing separators on the workdir prefix.
  const base =
    workdir.endsWith("/") || workdir.endsWith("\\") ? workdir : workdir + "/";
  if (filePath.startsWith(base)) {
    return filePath.slice(base.length);
  }
  // Path equals the workdir exactly, or isn't under it — show as-is.
  return filePath;
};

// Command verbs that precede a bare file name to keep it plain text (e.g.
// "run version.ts" is a shell command, not a file reference).
const COMMAND_VERBS =
  "run|build|edit|cat|open|cd|ls|rm|mv|cp|touch|mkdir|grep|read|write|create|delete|view|show|type|exec|start|stop|add|remove|install|test";

// One directory segment (may contain extra dots, e.g. jquery-3.6).
const DIR_SEG = "[\\p{L}\\p{N}_-]+(?:\\.[\\p{L}\\p{N}_-]+)*";
const FILE_EXT = "\\.[A-Za-z0-9_-]{2,}";
// Final file name without consuming the extension (so `.txt` stays required).
const FILE_STEM = "[\\p{L}\\p{N}_-]+";

// Matches a bare file path (relative with a slash, absolute, or ./ ../ ~/
// prefixed), optionally with a :line or :line:col suffix; plus a bare file
// name with an extension (e.g. version.ts) unless it directly follows a
// command verb. The final path segment must carry a file extension so
// extensionless paths (usually directories like /path/to/exams) are not
// linked. Constrained to path characters (Unicode letters/digits), never
// preceded by `](` (an existing markdown link target) or a URL scheme, and
// followed by whitespace/punctuation/EOL (including an em dash list separator).
const FILE_PATH_SOURCE = [
  "(?<!\\]\\()",
  "(?:^|(?<=[\\s(（]))",
  "(?!\\w+://)",
  "(",
  // Absolute or ./ ../ ~/ prefixed path. Leading/middle segments may lack an
  // extension (e.g. /Users/liuyuyang/projects), the final segment must have one.
  "(?:(?:\\.{1,2}|~)/|/)",
  `(?:${DIR_SEG}/)*`,
  `${FILE_STEM}(?:${FILE_EXT})+`,
  "(?::\\d+(?::\\d+)?)?",
  "|",
  // Relative path without a leading ./ or / (e.g. src/foo.ts): at least one
  // slash, final segment must have an extension.
  `(?:${DIR_SEG}/)+`,
  `${FILE_STEM}(?:${FILE_EXT})+`,
  "(?::\\d+(?::\\d+)?)?",
  "|",
  // Bare file name with an extension (e.g. version.ts) unless it directly
  // follows a command verb.
  `(?<!\\b(?:${COMMAND_VERBS})\\s)`,
  `[\\p{L}][\\p{L}\\p{N}_-]*(?:${FILE_EXT})+`,
  "(?::\\d+(?::\\d+)?)?",
  ")",
  "(?=[\\s,;.)\\]}）。，、；：！？!?…—–]|$)",
].join("");

const FILE_PATH_RE = new RegExp(FILE_PATH_SOURCE, "gu");

/** Wrap bare file paths in `[path](path)` markdown links. */
const linkifySegment = (text: string): string =>
  text.replace(FILE_PATH_RE, (_whole, path) => `[${path}](${path})`);

// Guards for code-span content that would break as an inline markdown link.
const CODE_SPAN_UNSAFE = /[[\]()<>\\]/;

/**
 * Linkify bare file paths in assistant markdown text so they open the file
 * panel when clicked. Fenced code blocks are left untouched; inline code
 * spans whose content is a path stay code-styled and are wrapped in a link.
 */
export const linkifyFilePaths = (markdown: string): string => {
  if (!markdown) return markdown;

  const tokens: string[] = [];
  let source = markdown.replace(
    /(```[\s\S]*?```)|(`[^`\n]+`)/g,
    (match, fenced: string | undefined, inline: string | undefined) => {
      if (fenced !== undefined) {
        tokens.push(fenced);
        return `\u0000${tokens.length - 1}\u0000`;
      }
      if (inline === undefined) {
        tokens.push(match);
        return `\u0000${tokens.length - 1}\u0000`;
      }
      const content = inline.slice(1, -1);
      // Only convert code spans that are exactly a linkable path; anything
      // with markdown link syntax characters is kept as-is.
      const linked = CODE_SPAN_UNSAFE.test(content)
        ? content
        : linkifySegment(content);
      if (linked === `[${content}](${content})`) {
        // Keep the original code-span UI; wrap it in a link so it is clickable.
        return `[\`${content}\`](${content})`;
      }
      if (linked !== content) {
        return linked;
      }
      tokens.push(inline);
      return `\u0000${tokens.length - 1}\u0000`;
    },
  );

  source = linkifySegment(source);
  return source.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)]);
};
