import React from "react";
import { resolveImageSrc } from "../../utils/resolveImageSrc";

/**
 * `<img>` for a transcript image ref. Filesystem refs paint straight from a
 * `file:` URL: the renderer cannot fetch them (CSP `connect-src`), and the
 * async detour only cost a blank frame per thumbnail plus a console error.
 */
export function ResolvedImage({
  src,
  alt,
  className,
  draggable = false,
}: {
  src: string;
  alt: string;
  className?: string;
  draggable?: boolean;
}): React.ReactElement | null {
  const resolved = React.useMemo(() => resolveImageSrc(src), [src]);
  if (!resolved) return null;
  return <img src={resolved} alt={alt} className={className} draggable={draggable} />;
}

/** Resolve src for preview handlers that need a paint-ready URL. */
export function useResolvedImageSrc(src: string | undefined): string | undefined {
  return React.useMemo(() => (src ? resolveImageSrc(src) : undefined), [src]);
}
