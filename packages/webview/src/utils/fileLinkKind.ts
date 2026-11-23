import { isImageFileName } from "./localFileMention";

const HTML_PREVIEW_PATH = /\.(html?|xhtml)$/i;

/** Local HTML opens in the built-in browser instead of the file source. */
export function isHtmlPreviewPath(filePath: string): boolean {
  const base = filePath.split(/[?#]/)[0] ?? filePath;
  return HTML_PREVIEW_PATH.test(base);
}

export type FileLinkKind = "image" | "browser" | "file";

/**
 * Where a local file link lands when clicked. Message attachments and issue
 * artifacts both read it, so a picture opens as a picture wherever it shows up.
 */
export function fileLinkKind(path: string): FileLinkKind {
  if (isImageFileName(path)) return "image";
  if (isHtmlPreviewPath(path)) return "browser";
  return "file";
}

/** Last path segment, for chip labels and image preview titles. */
export function fileBaseName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
}
