/** Path display helpers for the file panel toolbar. */

/** Middle-ellipsis so the file name stays visible when the path is long. */
export function middleEllipsis(text: string, max = 48): string {
  if (text.length <= max) return text;
  const fileName = text.slice(text.lastIndexOf("/") + 1);
  const headMax = max - fileName.length - 1;
  if (headMax > 8) return `${text.slice(0, headMax)}…${fileName}`;
  const head = Math.ceil((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(-(max - 1 - head))}`;
}

/**
 * Prefer a path relative to workdir when the file is under it;
 * otherwise return the absolute path.
 */
export function displayFilePath(absPath: string, workdir?: string): string {
  if (!workdir) return absPath;
  const wd = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = absPath.replace(/\\/g, "/");
  if (file === wd) return ".";
  if (file.startsWith(wd + "/")) return file.slice(wd.length + 1);
  return absPath;
}

/** Join a git-relative path with workdir for host openFile (needs absolute). */
export function resolveWorkspaceFilePath(
  filePath: string,
  workdir?: string,
): string {
  if (!filePath) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  if (/^([a-zA-Z]:\/|\/)/.test(normalized)) return filePath;
  if (!workdir) return filePath;
  const wd = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = normalized.replace(/^\.\/+/, "").replace(/^\/+/, "");
  return `${wd}/${rel}`;
}
