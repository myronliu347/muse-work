import type { ReactNode } from "react";
import { createPortal } from "react-dom";

function overlayHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  // Never portal into `.radix-themes` itself — React owns that node's children
  // and Radix popper would treat the whole app as a clipping boundary.
  return (
    (document.getElementById("muse-overlay-root") as HTMLElement | null) ??
    document.body
  );
}

/** Radix `container` prop: theme-scoped overlay, or undefined so Portal uses body. */
export function getOverlayHost(): HTMLElement | undefined {
  return overlayHost() ?? undefined;
}

/** Render overlays outside clipped ancestors, still inside the theme tree. */
export function bodyPortal(node: ReactNode) {
  const host = overlayHost();
  if (!host) return node;
  return createPortal(node, host);
}
