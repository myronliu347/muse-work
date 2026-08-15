/**
 * Local file reads for the desktop file panel.
 */

import * as fs from "fs";
import * as path from "path";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 2000;

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

const isMarkdownPath = (p: string) =>
  /\.(md|markdown|mdown|mkd)$/i.test(p);

/**
 * Rewrite workdir-relative images in markdown to inline data URIs so they
 * render inside the webview (which has no base URL for relative paths).
 * Remote URLs, absolute paths, and missing/oversized files are left alone.
 */
const embedMarkdownImages = (content: string, workdir: string): string => {
  const dataUriFor = (url: string): string | null => {
    if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(url)) return null;
    const abs = path.resolve(workdir, url);
    const ext = path.extname(abs).toLowerCase().replace(/^\./, "");
    if (!IMAGE_EXTS.has(ext)) return null;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_BYTES) return null;
      const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
      return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
    } catch {
      return null;
    }
  };
  // `![alt](url)` and `<img src="url">`; rewrite only the URL when resolvable.
  return content.replace(
    /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)|<img[^>]*\bsrc="([^"]+)"/g,
    (whole, mdUrl, imgSrc) => {
      const url = mdUrl ?? imgSrc;
      const uri = url ? dataUriFor(url) : null;
      return uri ? whole.replace(url, uri) : whole;
    },
  );
};

export type FilePanelView = {
  path: string;
  host: string;
  content?: string;
  imageBase64?: string;
  error?: string;
  unsupported?: "binary" | "too-large";
  sizeBytes?: number;
  truncated?: boolean;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
};

export async function readLocalFileForPanel(
  filePath: string,
  opts?: { startLine?: number; endLine?: number; workdir?: string },
): Promise<FilePanelView> {
  const host = "local";
  try {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) {
      return { path: filePath, host, error: `文件不存在：${filePath}` };
    }
    if (stat.isDirectory()) {
      return { path: filePath, host, error: "无法在面板中显示目录" };
    }

    if (stat.size > MAX_BYTES) {
      return {
        path: filePath,
        host,
        unsupported: "too-large",
        sizeBytes: stat.size,
        startLine: opts?.startLine,
        endLine: opts?.endLine,
      };
    }

    const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
    if (IMAGE_EXTS.has(ext)) {
      const data = await fs.promises.readFile(filePath);
      const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
      return {
        path: filePath,
        host,
        imageBase64: `data:${mime};base64,${data.toString("base64")}`,
        startLine: opts?.startLine,
        endLine: opts?.endLine,
      };
    }

    const readLen = MAX_BYTES + 1;
    const buf = Buffer.alloc(readLen);
    const handle = await fs.promises.open(filePath, "r");
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buf, 0, readLen, 0));
    } finally {
      await handle.close();
    }
    if (buf.subarray(0, Math.min(bytesRead, 8192)).includes(0)) {
      return {
        path: filePath,
        host,
        unsupported: "binary",
        sizeBytes: stat.size,
        startLine: opts?.startLine,
        endLine: opts?.endLine,
      };
    }
    const rawContent = buf
      .subarray(0, Math.min(bytesRead, MAX_BYTES))
      .toString("utf8");
    const allLines = rawContent.split("\n");
    const tooManyLines = allLines.length > MAX_LINES;
    const content =
      opts?.workdir && isMarkdownPath(filePath)
        ? embedMarkdownImages(rawContent, opts.workdir)
        : rawContent;
    return {
      path: filePath,
      host,
      content: tooManyLines ? allLines.slice(0, MAX_LINES).join("\n") : content,
      truncated: bytesRead > MAX_BYTES || tooManyLines,
      totalLines:
        bytesRead <= MAX_BYTES
          ? allLines.length - (rawContent.endsWith("\n") ? 1 : 0)
          : undefined,
      startLine: opts?.startLine,
      endLine: opts?.endLine,
    };
  } catch (err) {
    return {
      path: filePath,
      host,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
