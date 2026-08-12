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

export type FilePanelView = {
  path: string;
  host: string;
  content?: string;
  imageBase64?: string;
  error?: string;
  truncated?: boolean;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
};

export async function readLocalFileForPanel(
  filePath: string,
  opts?: { startLine?: number; endLine?: number },
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
      return { path: filePath, host, error: "二进制文件无法在面板中显示" };
    }
    const rawContent = buf
      .subarray(0, Math.min(bytesRead, MAX_BYTES))
      .toString("utf8");
    const allLines = rawContent.split("\n");
    const tooManyLines = allLines.length > MAX_LINES;
    return {
      path: filePath,
      host,
      content: tooManyLines
        ? allLines.slice(0, MAX_LINES).join("\n")
        : rawContent,
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
