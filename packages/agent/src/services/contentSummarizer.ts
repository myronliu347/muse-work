/**
 * Shared fast-model content processing.
 *
 * WebFetch runs every fetched page through a small, fast model, and the
 * reader-view artifact read summarizes someone else's page the same way.
 * Both go through this single implementation (prompt → answer).
 */

import type { ToolContext, ToolResult } from "../tools/types.js";
import TurndownService from "turndown";
import { logger } from "../utils/globalLogger.js";

/**
 * HTML beyond this size is not converted. A 1 MB cap keeps a pathological page
 * (deeply nested markup, a wall of inline styles) from pinning the CPU inside
 * turndown.
 */
const MAX_HTML_FOR_MARKDOWN = 1_048_576;

/** Turndown is stateless between calls, so one configured instance is reused. */
let markdownService: TurndownService | undefined;

/**
 * Nodes that never carry page content: `style`/`script` bodies and `noscript`
 * fallbacks would otherwise land in the markdown as text, and an `iframe`
 * contributes nothing but its URL.
 */
function getMarkdownService(): TurndownService {
  if (markdownService) return markdownService;
  const service = new TurndownService();
  service.remove(["style", "script", "noscript", "iframe"]);
  markdownService = service;
  return service;
}

/** Convert HTML to markdown for WebFetch. */
export function htmlToMarkdown(html: string): string {
  const overLimit = html.length > MAX_HTML_FOR_MARKDOWN;
  const source = overLimit ? html.slice(0, MAX_HTML_FOR_MARKDOWN) : html;

  let markdown: string;
  try {
    markdown = getMarkdownService().turndown(source);
  } catch (error) {
    // Conversion is best-effort: a turndown failure must not sink the whole read.
    logger.error(
      `Turndown failed, falling back to raw HTML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return html;
  }

  return overLimit
    ? `${markdown}\n\n[Content truncated due to length...]`
    : markdown;
}

/** Human-readable byte size (e.g. "512B", "2.0KB", "1.5MB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Run the fast model over `content` with `prompt` and return its answer as the
 * tool result. The main model only ever sees this answer.
 */
export async function processContentWithAI(
  url: string,
  prompt: string,
  content: string,
  statusCode: number,
  statusText: string,
  context: ToolContext,
  contentSize?: number,
): Promise<ToolResult> {
  if (!context.aiManager || !context.aiService) {
    return {
      success: false,
      content: content,
      error: "AI Manager or AI Service not available for processing content",
    };
  }

  const modelConfig = context.aiManager.getModelConfig();
  const fastModel = modelConfig.fastModel;

  const aiResponse = await context.aiService.processWebContent({
    gatewayConfig: context.aiManager.getGatewayConfig(),
    modelConfig: modelConfig,
    content: content,
    prompt: prompt,
    model: fastModel,
    abortSignal: context.abortSignal,
  });

  const sizeStr =
    contentSize !== undefined ? formatSize(contentSize) : "unknown size";
  const statusStr = `${statusCode} ${statusText}`.trim();

  return {
    success: true,
    content: aiResponse.content || "",
    shortResult: `Received ${sizeStr} (${statusStr}) from ${url}`,
  };
}
