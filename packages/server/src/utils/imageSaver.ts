import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Where pasted screenshots are persisted before being forwarded to the SDK. */
export function resolveUploadsDir(): string {
  return path.join(os.tmpdir(), "muse-work", "uploads");
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpeg";
  const m = /^image\/([a-z0-9.+-]+)$/i.exec(mediaType);
  return m ? m[1] : "png";
}

function isFilesystemPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Persist pasted screenshots to disk. data: URLs are decoded and written;
 * absolute filesystem paths are returned unchanged so callers can always keep
 * `imageUrls` as paths (UI resolves them on paint).
 */
export async function saveBase64Images(
  images: Array<{ data: string; mediaType?: string }>,
  dir: string = resolveUploadsDir(),
): Promise<string[]> {
  if (!images.length) return [];
  fs.mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (isFilesystemPath(img.data)) {
      paths.push(img.data);
      continue;
    }
    const match = /^data:[^;]+;base64,(.*)$/s.exec(img.data);
    if (!match) continue;
    const ext = extensionForMediaType(img.mediaType || "image/png");
    const filePath = path.join(dir, `${Date.now()}-${i}.${ext}`);
    await fsp.writeFile(filePath, Buffer.from(match[1], "base64"));
    paths.push(filePath);
  }
  return paths;
}
/** Append `[Image source: <path>]` markers after the content, one per image. */
export function appendImageSourceMarkers(
  content: string,
  imagePaths: string[],
): string {
  if (!imagePaths.length) return content;
  const markers = imagePaths.map((p) => `[Image source: ${p}]`).join("\n");
  return content.trim() ? `${content}\n\n${markers}` : markers;
}
