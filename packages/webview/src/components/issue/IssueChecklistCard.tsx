import React from "react";
import "../../styles/DesktopApp.css";
import { IssueTypeIcon } from "./IssueTypeIcon";

export interface IssueChecklistItem {
  id: string;
  content: string;
  status: string;
}

export interface IssueChecklistCardProps {
  issueId: string;
  title: string;
  type?: string;
  description?: string;
  status?: string;
  statusLabel?: string;
  items: IssueChecklistItem[];
}

const ISSUE_STATUS_LABEL: Record<string, string> = {
  pending: "待规划",
  planning: "规划中",
  executing: "执行中",
  review: "待审核",
  awaiting_close: "待关闭",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: "待办",
  running: "进行中",
  done: "完成",
};

/**
 * Hover card for an Issue row: title, description, status, then checklist.
 */
export const IssueChecklistCard: React.FC<IssueChecklistCardProps> = ({
  issueId,
  title,
  type,
  description,
  status,
  statusLabel: statusLabelProp,
  items,
}) => {
  const statusLabel = statusLabelProp
    ?? (status ? (ISSUE_STATUS_LABEL[status] ?? status) : undefined);
  const desc = description?.trim();
  return (
    <div
      className="issue-checklist-card"
      data-testid={`desktop-session-issue-checklist-${issueId}`}
    >
      <div className="issue-checklist-card-title">
        <IssueTypeIcon type={type} />
        {title}
      </div>
      {statusLabel ? (
        <div
          className={`issue-checklist-card-issue-status issue-checklist-card-issue-status-${status}`}
        >
          {statusLabel}
        </div>
      ) : null}
      {desc ? (
        <div className="issue-checklist-card-description">{desc}</div>
      ) : null}
      <div className="issue-checklist-card-heading">清单</div>
      {items.length === 0 ? (
        <div className="issue-checklist-card-empty">暂无清单</div>
      ) : (
        <ul className="issue-checklist-card-list">
          {items.map((item) => {
            const done = item.status === "done";
            const running = item.status === "running";
            return (
              <li
                key={item.id}
                className={`issue-checklist-card-item${done ? " issue-checklist-card-item-done" : ""}${running ? " issue-checklist-card-item-running" : ""}`}
              >
                <span
                  className={`issue-checklist-card-mark${done ? " issue-checklist-card-mark-done" : ""}${running ? " issue-checklist-card-mark-running" : ""}`}
                  aria-hidden="true"
                />
                <span className="issue-checklist-card-text">{item.content}</span>
                <span className="issue-checklist-card-status">
                  {ITEM_STATUS_LABEL[item.status] ?? item.status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default IssueChecklistCard;
