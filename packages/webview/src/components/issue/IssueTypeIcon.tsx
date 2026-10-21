import React from "react";
import { issueTypeMeta, type IssueTypeId } from "../../utils/issueType";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

const GLYPH: Record<IssueTypeId, React.ReactNode> = {
  bug: (
    <Glyph>
      <path d="M6.5 4.9 5.15 2.7M9.5 4.9 10.85 2.7" {...stroke} />
      <path
        d="M8 4.35c-1.85 0-3.15 1.85-3.15 4.15v1.15c0 2.05 1.4 3.55 3.15 3.55s3.15-1.5 3.15-3.55V8.5c0-2.3-1.3-4.15-3.15-4.15z"
        {...stroke}
      />
      <path
        d="M8 6.15v6.7M5.05 8.55 3.15 7.25M10.95 8.55 12.85 7.25M5.15 11.15 3.3 12.55M10.85 11.15 12.7 12.55"
        {...stroke}
      />
    </Glyph>
  ),
  feature: (
    <Glyph>
      <path
        d="M8 2.4a3.35 3.35 0 0 0-1.85 6.15c.35.28.55.7.55 1.15h2.6c0-.45.2-.87.55-1.15A3.35 3.35 0 0 0 8 2.4Z"
        {...stroke}
      />
      <path d="M6.7 11.1h2.6M7.15 12.7h1.7" {...stroke} />
    </Glyph>
  ),
  research: (
    <Glyph>
      <circle cx="7.1" cy="7.1" r="3.35" {...stroke} />
      <path d="M9.6 9.6 13.1 13.1" {...stroke} />
    </Glyph>
  ),
  analysis: (
    <Glyph>
      <path d="M3.4 13V8.2M8 13V3.2M12.6 13V6" {...stroke} />
    </Glyph>
  ),
  review: (
    <Glyph>
      <path d="M1.7 8S4.1 4.3 8 4.3 14.3 8 14.3 8 11.9 11.7 8 11.7 1.7 8 1.7 8Z" {...stroke} />
      <circle cx="8" cy="8" r="1.55" {...stroke} />
    </Glyph>
  ),
  work: (
    <Glyph>
      <rect x="3.1" y="2.5" width="9.8" height="11" rx="1.6" {...stroke} />
      <path d="M5.5 6.4h5M5.5 9h3.4" {...stroke} />
    </Glyph>
  ),
};

export function IssueTypeIcon({ type }: { type?: string }) {
  const meta = issueTypeMeta(type);
  return (
    <span
      className="issue-type-icon"
      title={meta.label}
      aria-label={meta.label}
      data-testid={`issue-type-${meta.id}`}
    >
      {GLYPH[meta.id]}
    </span>
  );
}
