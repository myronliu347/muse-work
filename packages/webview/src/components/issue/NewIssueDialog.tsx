import React, { useEffect, useRef, useState } from "react";
import type { MuseApiClient, MuseIssuePriority } from "../../muse/apiClient";
import "../../styles/ConfirmDialog.css";
import "../../styles/NewIssueDialog.css";

export interface NewIssueDialogProps {
  api: MuseApiClient;
  onCreated: () => void;
  onCancel: () => void;
}

/**
 * Modal form to create a pending Issue (title required; description / priority / tags optional).
 */
export const NewIssueDialog: React.FC<NewIssueDialogProps> = ({
  api,
  onCreated,
  onCancel,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<MuseIssuePriority>("p1");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const pending = tagDraft.trim();
      const nextTags = pending
        ? tags.some((t) => t.toLowerCase() === pending.toLowerCase())
          ? tags
          : [...tags, pending]
        : tags;
      await api.createIssue({
        title: trimmed,
        description: description.trim() || undefined,
        priority,
        tags: nextTags.length > 0 ? nextTags : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="confirm-dialog-overlay"
      data-testid="new-issue-dialog-overlay"
    >
      <form
        className="confirm-dialog new-issue-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新建 Issue"
        onSubmit={handleSubmit}
      >
        <div className="new-issue-dialog-head">
          <div className="confirm-dialog-title">新建 Issue</div>
          <p className="new-issue-dialog-lead">登记一件要做成的事，稍后打开规划会话</p>
        </div>
        <label className="new-issue-field">
          <span className="new-issue-label">标题</span>
          <input
            className="new-issue-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="new-issue-title"
            autoFocus
            required
            disabled={submitting}
            placeholder="例如：修复登录校验"
          />
        </label>
        <label className="new-issue-field">
          <span className="new-issue-label">描述</span>
          <textarea
            className="new-issue-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="new-issue-description"
            rows={3}
            disabled={submitting}
            placeholder="可选，补充背景或验收标准"
          />
        </label>
        <fieldset className="new-issue-field new-issue-priority" disabled={submitting}>
          <legend className="new-issue-label">优先级</legend>
          <div className="new-issue-priority-chips">
            {(
              [
                { id: "p0", name: "紧急" },
                { id: "p1", name: "普通" },
                { id: "p2", name: "较低" },
              ] as const
            ).map((p) => (
              <label
                key={p.id}
                className={`new-issue-priority-chip new-issue-priority-chip-${p.id}${priority === p.id ? " is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="new-issue-priority"
                  value={p.id}
                  checked={priority === p.id}
                  onChange={() => setPriority(p.id)}
                  data-testid={`new-issue-priority-${p.id}`}
                />
                <span className="new-issue-priority-key">{p.id.toUpperCase()}</span>
                <span className="new-issue-priority-name">{p.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="new-issue-field">
          <span className="new-issue-label">标签</span>
          <div
            className="new-issue-chips"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="new-issue-chip"
                data-testid={`new-issue-tag-${tag}`}
              >
                {tag}
                <button
                  type="button"
                  className="new-issue-chip-remove"
                  aria-label={`移除 ${tag}`}
                  disabled={submitting}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTags((prev) => prev.filter((t) => t !== tag));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              className="new-issue-chip-input"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  const next = tagDraft.trim().replace(/,$/, "");
                  if (
                    next &&
                    !tags.some((t) => t.toLowerCase() === next.toLowerCase())
                  ) {
                    setTags((prev) => [...prev, next]);
                  }
                  setTagDraft("");
                } else if (e.key === "Backspace" && !tagDraft && tags.length) {
                  setTags((prev) => prev.slice(0, -1));
                }
              }}
              onBlur={() => {
                const next = tagDraft.trim();
                if (
                  next &&
                  !tags.some((t) => t.toLowerCase() === next.toLowerCase())
                ) {
                  setTags((prev) => [...prev, next]);
                }
                setTagDraft("");
              }}
              data-testid="new-issue-tags"
              placeholder={tags.length === 0 ? "输入后回车添加" : ""}
              disabled={submitting}
            />
          </div>
        </div>
        {error ? (
          <div className="new-issue-error" data-testid="new-issue-error">
            {error}
          </div>
        ) : null}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-cancel"
            data-testid="new-issue-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="confirm-dialog-btn confirm-dialog-btn-confirm"
            data-testid="new-issue-submit"
            disabled={submitting || !title.trim()}
          >
            创建
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewIssueDialog;
