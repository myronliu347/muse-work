import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const roots = new Map<Element, Root>();

/** Mount a React tree into a contenteditable chip host (not the app root). */
export function renderInEditorHost(host: Element, node: ReactNode): Root {
  let root = roots.get(host);
  if (!root) {
    root = createRoot(host);
    roots.set(host, root);
  }
  root.render(node);
  return root;
}

export function unmountEditorHost(host: Element): void {
  const root = roots.get(host);
  if (!root) return;
  root.unmount();
  roots.delete(host);
}

/** Unmount chip roots before wiping editor DOM so portaled tooltips do not leak. */
export function unmountEditorHostsIn(container: ParentNode): void {
  for (const [host, root] of [...roots]) {
    if (host === container || container.contains(host)) {
      root.unmount();
      roots.delete(host);
    }
  }
}

/** Backspace / browser edits can detach chips without going through our wipe helpers. */
export function unmountDisconnectedEditorHosts(): void {
  for (const [host, root] of [...roots]) {
    if (!host.isConnected) {
      root.unmount();
      roots.delete(host);
    }
  }
}
