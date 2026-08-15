import type { FileItem } from "../types";
import { toRelativePath } from "./messageUtils";

const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

export function isImageFileName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

export function fileItemFromAbsolutePath(
  absolutePath: string,
  workdir?: string,
): FileItem {
  const normalized = absolutePath.replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).pop() || absolutePath;
  const relativePath = toRelativePath(absolutePath, workdir);
  const dot = name.lastIndexOf(".");
  const extension =
    !name.startsWith(".") && dot > 0 ? name.slice(dot + 1) : "";
  return {
    path: absolutePath,
    relativePath,
    name,
    extension,
    icon: "codicon-file",
    isDirectory: false,
  };
}

export function parseFileUriList(uriList: string): string[] {
  const out: string[] = [];
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.toLowerCase().startsWith("file:")) continue;
    try {
      const u = new URL(trimmed);
      let p = decodeURIComponent(u.pathname);
      // file:///C:/... on Windows → /C:/... ; strip leading slash before drive
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      out.push(p);
    } catch {
      // skip
    }
  }
  return out;
}

function looksLikeDirectoryPath(p: string): boolean {
  return /[/\\]$/.test(p);
}

export function parseClipboardLocalFiles(
  clipboardData: DataTransfer | null | undefined,
): Array<{ absolutePath: string; file?: File; isImage: boolean }> {
  if (!clipboardData) return [];
  const byPath = new Map<
    string,
    { absolutePath: string; file?: File; isImage: boolean }
  >();

  const files = clipboardData.files;
  if (files?.length) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const abs =
        typeof (file as File & { path?: string }).path === "string"
          ? (file as File & { path?: string }).path!
          : "";
      if (!abs || looksLikeDirectoryPath(abs)) continue;
      byPath.set(abs, {
        absolutePath: abs,
        file,
        isImage: isImageFileName(file.name || abs),
      });
    }
  }

  if (byPath.size === 0) {
    const uriList = clipboardData.getData?.("text/uri-list") || "";
    for (const abs of parseFileUriList(uriList)) {
      if (looksLikeDirectoryPath(abs)) continue;
      const name = abs.replace(/\\/g, "/").split("/").pop() || abs;
      byPath.set(abs, {
        absolutePath: abs,
        isImage: isImageFileName(name),
      });
    }
  }

  return [...byPath.values()];
}
