import { pathToFileUrl } from "./pathToFileUrl";

/** Fingerprint/path → blob URL so thumbs share one decode per file. */
const blobUrlByKey = new Map<string, string>();

export function clearResolvedImageBlobCacheForTests(): void {
  for (const url of blobUrlByKey.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
  blobUrlByKey.clear();
}

export function isImmediateImageSrc(src: string): boolean {
  return (
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("file:")
  );
}

/** Absolute filesystem path (POSIX or Windows), not a URL scheme. */
export function isFilesystemImagePath(src: string): boolean {
  return src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src);
}

/**
 * Resolve a transcript image ref to something `<img>` can paint.
 * data:/blob:/http(s):/file: pass through; filesystem paths are fetched once
 * and cached as blob: URLs so ChatState only retains the short path.
 */
export async function resolveImageSrc(src: string): Promise<string> {
  if (!src) return src;
  if (isImmediateImageSrc(src)) return src;
  if (!isFilesystemImagePath(src)) return src;

  const cached = blobUrlByKey.get(src);
  if (cached) return cached;

  const fileUrl = pathToFileUrl(src);
  if (typeof fetch !== "function" || typeof URL?.createObjectURL !== "function") {
    return fileUrl;
  }

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`failed to read image ${src}: ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    blobUrlByKey.set(src, blobUrl);
    return blobUrl;
  } catch {
    // Electron/file:// fetch can fail depending on origin; file: still paints.
    return fileUrl;
  }
}
