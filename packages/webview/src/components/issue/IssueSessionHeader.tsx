import React, { type ReactNode } from "react";
import "../../styles/IssueSessionHeader.css";

export type IssueViewTab = "planning" | "execution";

export interface IssueSessionHeaderProps {
  title: string;
  activeTab: IssueViewTab;
  onTabChange: (tab: IssueViewTab) => void;
  showTabs: boolean;
  executionEnabled: boolean;
  /** 顶栏右侧：面板切换、会话指令等（与 ChatHeader 一致）。 */
  actions?: ReactNode;
  /** corner：收进 Muse Bot 标签栏右上角，不再占一行。 */
  placement?: "row" | "corner";
}

export const IssueSessionHeader: React.FC<IssueSessionHeaderProps> = ({
  title,
  activeTab,
  onTabChange,
  showTabs,
  executionEnabled,
  actions,
  placement = "row",
}) => {
  return (
    <div
      className={`issue-session-header${placement === "corner" ? " issue-session-header--corner" : ""}`}
      data-testid="issue-session-header"
    >
      <div className="issue-session-header-top">
        <div
          className="issue-session-header-title"
          data-testid="issue-session-title"
        >
          {title}
        </div>
        <div className="issue-session-header-trailing">
          {showTabs ? (
            <div
              className={`issue-session-segmented issue-session-segmented--${activeTab}`}
              role="tablist"
              aria-label="Issue 会话"
              data-testid="issue-session-tabs"
            >
              <span
                className="issue-session-segment-glide"
                aria-hidden="true"
              />
              <button
                type="button"
                role="tab"
                className={`issue-session-segment${activeTab === "planning" ? " issue-session-segment--active" : ""}`}
                aria-selected={activeTab === "planning"}
                data-testid="issue-session-tab-planning"
                onClick={() => onTabChange("planning")}
              >
                规划
              </button>
              <button
                type="button"
                role="tab"
                className={`issue-session-segment${activeTab === "execution" ? " issue-session-segment--active" : ""}`}
                aria-selected={activeTab === "execution"}
                data-testid="issue-session-tab-execution"
                disabled={!executionEnabled}
                onClick={() => onTabChange("execution")}
              >
                执行
              </button>
            </div>
          ) : null}
          {actions ? (
            <div className="issue-session-header-actions">{actions}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
