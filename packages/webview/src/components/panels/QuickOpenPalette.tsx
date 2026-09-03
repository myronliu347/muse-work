import React, { useEffect, useRef, useState } from "react";
import { FileIcon } from "./FileIcon";

export type QuickOpenHit = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory?: boolean;
};

export type QuickOpenPaletteProps = {
  open: boolean;
  workdir: string | undefined;
  vscode: { postMessage: (msg: unknown) => void };
  onClose: () => void;
  onOpenFile: (absPath: string) => void;
  /** Prefill when opened from a multi-hit markdown link. */
  initialQuery?: string;
};

let quickOpenSeq = 0;

export const QuickOpenPalette: React.FC<QuickOpenPaletteProps> = ({
  open,
  workdir,
  vscode,
  onClose,
  onOpenFile,
  initialQuery = "",
}) => {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QuickOpenHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setSelectedIndex(0);
      return;
    }
    setQuery(initialQuery);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const onMsg = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.command !== "fileSuggestionsResponse") return;
      if (data.requestId !== requestIdRef.current) return;
      const suggestions = Array.isArray(data.suggestions)
        ? (data.suggestions as QuickOpenHit[])
        : [];
      setHits(suggestions.filter((s) => !s.isDirectory));
      setSelectedIndex(0);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (!q || !workdir) {
      setHits([]);
      requestIdRef.current = undefined;
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const requestId = `qo-${++quickOpenSeq}`;
      requestIdRef.current = requestId;
      vscode.postMessage({
        command: "requestFileSuggestions",
        requestId,
        filterText: q,
        dir: "",
        workdir,
        source: "quickOpen",
      });
    }, 150);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, query, workdir, vscode]);

  if (!open) return null;

  const openSelected = () => {
    const hit = hits[selectedIndex];
    if (!hit) return;
    onOpenFile(hit.path);
    onClose();
  };

  return (
    <div
      className="quick-open-backdrop"
      data-testid="quick-open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-label="快速打开"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) =>
              hits.length ? Math.min(i + 1, hits.length - 1) : 0,
            );
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            openSelected();
          }
        }}
      >
        <input
          ref={inputRef}
          className="quick-open-input"
          data-testid="quick-open-input"
          placeholder="按文件名搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="quick-open-list">
          {!workdir ? (
            <div className="quick-open-empty">选择工作目录后打开文件</div>
          ) : !query.trim() ? (
            <div className="quick-open-empty">输入文件名开始搜索</div>
          ) : hits.length === 0 ? (
            <div className="quick-open-empty">无匹配文件</div>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.path}
                type="button"
                className={`quick-open-item${
                  i === selectedIndex ? " quick-open-item--active" : ""
                }`}
                data-testid={`quick-open-item-${hit.relativePath}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => {
                  onOpenFile(hit.path);
                  onClose();
                }}
              >
                <FileIcon name={hit.name} className="file-tree-icon" />
                <span className="quick-open-item-path">{hit.relativePath}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickOpenPalette;
