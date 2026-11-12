import { pathToFileUrl } from "./pathToFileUrl";

/** Absolute filesystem path (POSIX or Windows), not a URL scheme. */
export function isFilesystemImagePath(src: string): boolean {
  return src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src);
}

/**
 * Resolve a transcript image ref to something `<img>` can paint.
 *
 * Filesystem paths become `file:` URLs and are painted directly. They must not
 * be read with `fetch`: the webview CSP is `default-src 'none'` with no
 * `file:` in `connect-src`, so every attempt was refused and logged a
 * connect-src violation before falling back to the same `file:` URL. The
 * `<img>` tag is fine — `img-src 'self'` covers the page's own `file:` scheme.
 */
export function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (!isFilesystemImagePath(src)) return src;
  return pathToFileUrl(src);
}
