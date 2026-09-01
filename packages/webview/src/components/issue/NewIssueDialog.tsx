import React, { useEffect, useState } from "react";
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
  const [tagsText, setTagsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.createIssue({
        title: trimmed,
        description: description.trim() || undefined,
        priority,
        tags: tags.length > 0 ? tags : undefined,
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
        <div className="confirm-dialog-title">新建 Issue</div>
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
          />
        </label>
        <fieldset className="new-issue-field new-issue-priority" disabled={submitting}>
          <legend className="new-issue-label">优先级</legend>
          {(["p0", "p1", "p2"] as MuseIssuePriority[]).map((p) => (
            <label key={p} className="new-issue-priority-option">
              <input
                type="radio"
                name="new-issue-priority"
                value={p}
                checked={priority === p}
                onChange={() => setPriority(p)}
                data-testid={`new-issue-priority-${p}`}
              />
              {p.toUpperCase()}
            </label>
          ))}
        </fieldset>
        <label className="new-issue-field">
          <span className="new-issue-label">标签（逗号分隔）</span>
          <input
            className="new-issue-input"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            data-testid="new-issue-tags"
            placeholder="bug, frontend"
            disabled={submitting}
          />
        </label>
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
