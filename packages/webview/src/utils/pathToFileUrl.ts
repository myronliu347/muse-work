/**
 * Convert an absolute filesystem path into a file:// URL for the built-in
 * preview pane. POSIX (`/Users/…`) and Windows drive (`C:\…` / `C:/…`) paths
 * are supported; anything non-absolute is returned unchanged so callers can
 * fall back to their own handling.
 */
export function pathToFileUrl(path: string): string {
  const trimmed = path.trim();
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, "/")}`;
  }
  if (trimmed.startsWith("/")) {
    return `file://${trimmed}`;
  }
  return trimmed;
}
