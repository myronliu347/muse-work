import React from "react";
import { Tooltip } from "../shared/Tooltip";
import { NewSessionIcon } from "../shared/HeaderIcons";
import museM from "../../assets/muse-m.svg";
import {
  SessionTree,
  SESSION_DRAG_MIME,
  formatRelativeActiveAt,
  groupRecentSessionsByWorkdir,
  isTaskProjectWorkdir,
  partitionRecentSessions,
  resolveSidebarSessions,
} from "../session/SessionTree";
import type {
  DesktopSessionGroup,
  DesktopSessionEntry,
  DesktopIssueGroup,
} from "../../types";
import type { PopoChatSummary } from "../../muse/apiClient";
import "../../styles/DesktopApp.css";

export {
  SESSION_DRAG_MIME,
  SessionTree,
  formatRelativeActiveAt,
  groupRecentSessionsByWorkdir,
  isTaskProjectWorkdir,
  partitionRecentSessions,
  resolveSidebarSessions,
};

export type { WorkdirSessionGroup } from "../session/SessionTree";

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().startsWith("MAC");

export interface DesktopSidebarProps {
  onNewSession: () => void;
  /** Cmd/Ctrl+Click on the 新对话 button: start the new session in an additional pane. */
  onNewSessionInPane: () => void;
  /**
   * Start a draft session with this workdir pre-selected (workdir group "+" button).
   */
  onNewSessionInWorkdir?: (workdir: string) => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
  /** Opens provider settings from the sidebar footer. */
  onOpenSettings: () => void;
  /**
   * Legacy session tree groups. Prefer `pinnedSessions` / `recentSessions`.
   * When those are omitted, pin/recent groups are derived from workdir
   * `"pin"` / `"recent"` entries (Task 5 `buildSidebarModel`).
   */
  sessionTree?: DesktopSessionGroup[];
  /** Sessions in the 置顶 section. */
  pinnedSessions?: DesktopSessionEntry[];
  /** Sessions in the 工作空间 / 任务 sections (split by workdir kind). */
  recentSessions?: DesktopSessionEntry[];
  /** Issue 分组（侧栏「待办事项」）。 */
  issueGroups?: DesktopIssueGroup[];
  /** Active session id — drives current highlight and unread-dot suppression. */
  currentSessionId?: string;
  /** Sessions shown in panes — those other than currentSessionId get a weak highlight. */
  visibleSessionIds?: string[];
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Cmd/Ctrl+Click: open the session in an additional pane to the right. */
  onOpenPane: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index (also cleans up worktree if applicable). */
  onDeleteSession: (sessionId: string) => void;
  /** Hover pin button: toggle pinned membership. */
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  /** Persist a renamed session title (double-click title to edit). */
  onRenameSession?: (sessionId: string, title: string) => void;
  /** Open the workdir in VS Code via `code <workdir>`. */
  onOpenInEditor?: (workdir: string) => void;
  /** Open the workdir in the system terminal. */
  onOpenInTerminal?: (workdir: string) => void;
  /** Reveal the workdir in the system file manager. */
  onRevealInFinder?: (workdir: string) => void;
  /** 待办事项 section「+」→ 新建 Issue。 */
  onNewIssue?: () => void;
  /** 无会话 Issue 空态 → 打开会话。 */
  onOpenPlanning?: (issueId: string) => void;
  /** 分组行更多菜单 → 完成 Issue。 */
  onCompleteIssue?: (issueId: string) => void;
  /** 分组行更多菜单 → 取消 Issue。 */
  onCancelIssue?: (issueId: string) => void;
  /** 本地已配置 POPO（~/.popo-config.json）；false 时不显示 POPO 会话栏 */
  popoEnabled?: boolean;
  popoChats?: PopoChatSummary[];
  selectedPopoChatKey?: string | null;
  onSelectPopoChat?: (chatKey: string) => void;
  onDeletePopoChat?: (chatKey: string) => void;
  /** 当前高亮的菜单项（选中态） */
  activeMenu?: "newChat";
}

/**
 * Left rail for the desktop host: "新对话", session tree, and footer.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  onNewSessionInPane,
  onNewSessionInWorkdir,
  isStreaming,
  disabled,
  onOpenSettings,
  sessionTree,
  pinnedSessions,
  recentSessions,
  issueGroups,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
  onTogglePin,
  onRenameSession,
  onOpenInEditor,
  onOpenInTerminal,
  onRevealInFinder,
  onNewIssue,
  onOpenPlanning,
  onCompleteIssue,
  onCancelIssue,
  popoEnabled,
  popoChats,
  selectedPopoChatKey,
  onSelectPopoChat,
  onDeletePopoChat,
  activeMenu,
}) => {
  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="app-menus">
        <button
          className={`app-menu${activeMenu === "newChat" ? " active" : ""}`}
          onClick={(e) => {
            if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
              onNewSessionInPane();
            } else {
              onNewSession();
            }
          }}
          // 新对话仅在无 workdir 时禁用；streaming 中也可开新会话（spec §7）。
          disabled={disabled}
          title={
            isMacPlatform()
              ? "新对话（⌘N，⌘+点击并排打开）"
              : "新对话（Ctrl+N，Ctrl+点击并排打开）"
          }
          data-testid="desktop-new-session"
        >
          <NewSessionIcon className="app-menu-icon" />
          <span>新对话</span>
        </button>
      </div>
      <div className="divider" />
      <SessionTree
        sessionTree={sessionTree}
        pinnedSessions={pinnedSessions}
        recentSessions={recentSessions}
        issueGroups={issueGroups}
        currentSessionId={currentSessionId}
        visibleSessionIds={visibleSessionIds}
        isStreaming={isStreaming}
        onSelectSession={onSelectSession}
        onOpenPane={onOpenPane}
        onDeleteSession={onDeleteSession}
        onTogglePin={onTogglePin}
        onRenameSession={onRenameSession}
        onNewSessionInWorkdir={onNewSessionInWorkdir}
        onOpenInEditor={onOpenInEditor}
        onOpenInTerminal={onOpenInTerminal}
        onRevealInFinder={onRevealInFinder}
        onNewIssue={onNewIssue}
        onOpenPlanning={onOpenPlanning}
        onCompleteIssue={onCompleteIssue}
        onCancelIssue={onCancelIssue}
        popoEnabled={popoEnabled}
        popoChats={popoChats}
        selectedPopoChatKey={selectedPopoChatKey}
        onSelectPopoChat={onSelectPopoChat}
        onDeletePopoChat={onDeletePopoChat}
      />
      <div className="desktop-sidebar-footer" data-testid="desktop-sidebar-footer">
        <span className="desktop-sidebar-logo-wrap" data-testid="desktop-brand">
          <img
            src={museM}
            alt="Muse"
            className="desktop-sidebar-logo"
            draggable={false}
          />
        </span>
        <Tooltip text="设置" position="top">
          <button
            type="button"
            className="desktop-sidebar-settings-btn"
            onClick={onOpenSettings}
            data-testid="desktop-settings-btn"
            aria-label="设置"
          >
            <span className="codicon codicon-settings-gear" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default DesktopSidebar;
