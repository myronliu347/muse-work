import React, { useEffect, useState } from "react";
import {
  isFilesystemImagePath,
  isImmediateImageSrc,
  resolveImageSrc,
} from "../../utils/resolveImageSrc";

/**
 * `<img>` that keeps transcript state on path/data refs and only materializes
 * a blob: URL while painting filesystem paths.
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
  const [resolved, setResolved] = useState<string | undefined>(() =>
    src && isImmediateImageSrc(src) ? src : undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setResolved(undefined);
      return;
    }
    if (isImmediateImageSrc(src)) {
      setResolved(src);
      return;
    }
    if (!isFilesystemImagePath(src)) {
      setResolved(src);
      return;
    }
    setResolved(undefined);
    void resolveImageSrc(src)
      .then((url) => {
        if (!cancelled) setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setResolved(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!resolved) return null;
  return (
    <img src={resolved} alt={alt} className={className} draggable={draggable} />
  );
}

/** Resolve src for preview handlers that need a paint-ready URL. */
export function useResolvedImageSrc(src: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() =>
    src && isImmediateImageSrc(src) ? src : undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setResolved(undefined);
      return;
    }
    if (isImmediateImageSrc(src)) {
      setResolved(src);
      return;
    }
    void resolveImageSrc(src)
      .then((url) => {
        if (!cancelled) setResolved(url);
      })
      .catch(() => {
        if (!cancelled) setResolved(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  return resolved;
}
