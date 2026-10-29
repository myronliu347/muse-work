import React, { useEffect, useRef } from "react";
import { useMuseTheme } from "../../ui/theme";
import { highlightFence, langFromFence } from "../../utils/shikiHighlighter";

/**
 * Sanitized markdown HTML. Fenced code is colored after paint so the first
 * frame stays the plain block, then tokens replace it.
 */
export function MarkdownView({
  html,
  className,
  onClick,
  as = "div",
}: {
  html: string;
  className?: string;
  onClick?: (event: React.MouseEvent) => void;
  as?: "div" | "span";
}) {
  const ref = useRef<HTMLElement>(null);
  const { effective } = useMuseTheme();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    const dark = effective !== "light";
    const codes = [...root.querySelectorAll("pre > code")];
    void (async () => {
      for (const code of codes) {
        const token = code.className.match(/language-([\w#+.-]+)/)?.[1] ?? null;
        const inner = await highlightFence(code.textContent ?? "", langFromFence(token), dark);
        if (cancelled) return;
        if (inner && code.isConnected) code.innerHTML = inner;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, effective]);

  return React.createElement(as, {
    ref,
    className,
    onClick,
    dangerouslySetInnerHTML: { __html: html },
  });
}
