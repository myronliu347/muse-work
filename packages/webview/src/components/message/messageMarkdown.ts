import DOMPurify from "dompurify";
import { marked } from "marked";
import { linkifyFilePaths } from "../../utils/messageUtils";

// Configure marked for VS Code webview context
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    listitem(text: string, task: boolean, checked: boolean) {
      if (task) {
        return `<li class="task-list-item${checked ? " checked" : ""}">${text}</li>`;
      }
      return `<li>${text}</li>`;
    },
  },
});

// Interface for parsed markdown content that may contain mermaid diagrams
export interface ParsedMarkdownContent {
  elements: Array<{
    type: "html" | "mermaid";
    content: string;
    id?: string;
  }>;
}

// Parse markdown content and extract mermaid blocks
export function parseMarkdownWithMermaid(content: string): ParsedMarkdownContent {
  if (!content || content.trim() === "") {
    return { elements: [] };
  }

  const elements: Array<{
    type: "html" | "mermaid";
    content: string;
    id?: string;
  }> = [];

  // Split content by mermaid blocks
  const parts = content.split(/(```mermaid\n[\s\S]*?\n```)/g);

  let mermaidIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.match(/^```mermaid\n[\s\S]*?\n```$/)) {
      // This is a mermaid block
      const mermaidContent = part
        .replace(/^```mermaid\n/, "")
        .replace(/\n```$/, "")
        .trim();
      elements.push({
        type: "mermaid",
        content: mermaidContent,
        id: `mermaid-${mermaidIndex++}`,
      });
    } else if (part.trim()) {
      // This is regular markdown content
      const html = marked.parse(linkifyFilePaths(part));
      const sanitizedHtml = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "strong",
          "b",
          "em",
          "i",
          "code",
          "pre",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ul",
          "ol",
          "li",
          "a",
          "blockquote",
          "hr",
          "img",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "del",
          "input",
        ],
        ALLOWED_ATTR: [
          "href",
          "title",
          "align",
          "type",
          "checked",
          "disabled",
          "class",
          "src",
          "alt",
        ],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: [],
        FORBID_TAGS: [],
      });

      if (typeof sanitizedHtml === "string" && sanitizedHtml.trim()) {
        elements.push({
          type: "html",
          content: sanitizedHtml,
        });
      }
    }
  }

  return { elements };
}

