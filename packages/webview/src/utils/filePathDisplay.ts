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

/**
 * Markdown/HTML hrefs percent-encode non-ASCII names (`认证指引.md` →
 * `%E8%AE%A4…md`). Decode so openFile hits the real path. Leaves the string
 * unchanged when it is not encoded or is malformed.
 */
export function decodeFileHref(href: string): string {
  if (!href || !/%[0-9A-Fa-f]{2}/.test(href)) return href;
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * Join a git-relative path with workdir for host openFile (needs absolute).
 * `~/…` stays intact: the host expands it against the home directory. Joining
 * it here turns `~/Documents/a.html` into `<workdir>/~/Documents/a.html`.
 */
export function resolveWorkspaceFilePath(
  filePath: string,
  workdir?: string,
): string {
  if (!filePath) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "~" || normalized.startsWith("~/")) return normalized;
  if (/^([a-zA-Z]:\/|\/)/.test(normalized)) return filePath;
  if (!workdir) return filePath;
  const wd = workdir.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = normalized.replace(/^\.\/+/, "").replace(/^\/+/, "");
  return `${wd}/${rel}`;
}

/**
 * Short display name for a file: the basename, extended with one parent
 * directory at a time when several files in the same group share the label,
 * so names stay unique without showing the full path.
 *
 * `paths` is the full set of paths rendered together (e.g. one turn's
 * snapshots); `path` is the one to label. Returns e.g. "ChatApp.tsx" or
 * "components/ChatApp.tsx" when another ChatApp.tsx exists.
 */
export function displayFileName(path: string, paths: string[]): string {
  if (!path) return path;
  const norm = path.replace(/\\/g, "/");
  const segs = norm.split("/").filter(Boolean);
  for (let depth = 1; depth <= segs.length; depth++) {
    const candidate = segs.slice(-depth).join("/");
    const peers = paths.filter((p) => {
      if (p === path) return false;
      return (
        p.replace(/\\/g, "/").split("/").filter(Boolean).slice(-depth).join("/") ===
        candidate
      );
    });
    if (peers.length === 0) return candidate;
  }
  return norm;
}
