import React, { useState, type ReactNode } from "react";

/**
 * Lightweight disclosure row: a button trigger plus optional preview and an
 * animated-free body. Native <details> cannot keep its open state under a
 * controlled React parent without re-applying `open` on every render.
 */
export function Disclosure({
  title,
  preview,
  defaultOpen = false,
  className,
  testId,
  children,
}: {
  title: ReactNode;
  preview?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className} data-testid={testId}>
      <button
        type="button"
        className="disclosure-trigger"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="disclosure-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="disclosure-title">{title}</span>
        {preview ? <span className="disclosure-preview">{preview}</span> : null}
      </button>
      {open ? <div className="disclosure-body">{children}</div> : null}
    </div>
  );
}
