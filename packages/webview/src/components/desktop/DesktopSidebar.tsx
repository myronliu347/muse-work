import React, { useEffect, useState } from "react";
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
import type { ShellSurface } from "./shellSurface";
import { Tooltip } from "../shared/Tooltip";
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
  /** CodeMaker SSO from the sidebar footer (next to settings). */
  onLogin?: () => void;
  isAuthenticated?: boolean;
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
  /** Issue 分组（侧栏「待办事项」）。图标栏不渲染。 */
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
  /** 进入 Issue 详情（主区 Tab 切换规划/执行）。 */
  onSelectIssue?: (issueId: string) => void;
  /** 分组行更多菜单 → 完成 Issue。note 是一句结果结论。 */
  onCompleteIssue?: (issueId: string, note: string) => void;
  /** 分组行更多菜单 → 取消 Issue。note 是一句原因。 */
  onCancelIssue?: (issueId: string, note: string) => void;
  /** 当前高亮的图标。 */
  activeMenu?: ShellSurface | "newChat";
  /** 图标栏「会话」。 */
  onOpenSessions?: () => void;
  /** 图标栏「自动化」。 */
  onOpenAutomations?: () => void;
  /** 图标栏「技能」。 */
  onOpenSkills?: () => void;
  /** 图标栏「Muse Bot」。 */
  onOpenAssistant?: () => void;
  /** 抽屉滑出视口时，避免焦点与读屏进入侧栏。 */
  sidebarAccessHidden?: boolean;
}

function RailIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 星芒：大星加右上、左下两处小十字。 */
function MuseBotIcon() {
  return (
    <RailIcon>
      <path
        d="M9.94 15.5a2 2 0 0 0-1.44-1.44L2.36 12.48a.5.5 0 0 1 0-.96l6.14-1.58A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 3v4M22 5h-4M4 17v2M5 18H3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </RailIcon>
  );
}

/** 会话：对话气泡。 */
function SessionsIcon() {
  return (
    <RailIcon>
      <path
        d="M5 6.4h14a1.6 1.6 0 0 1 1.6 1.6v6.6a1.6 1.6 0 0 1-1.6 1.6h-8.2L6.4 19.2v-3H5A1.6 1.6 0 0 1 3.4 14.6V8A1.6 1.6 0 0 1 5 6.4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </RailIcon>
  );
}

/** 自动化：时钟。 */
function AutomationsRailIcon() {
  return (
    <RailIcon>
      <circle cx="12" cy="12" r="7.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 8.1V12.1l2.7 1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </RailIcon>
  );
}

/** 技能：带凸起的拼图块。 */
function SkillsIcon() {
  return (
    <RailIcon>
      <path
        d="M5.2 7.2V19.2H16.6V16.4A3 3 0 0 1 16.6 10.8V7.2H14.2A3 3 0 0 0 8.6 7.2H5.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </RailIcon>
  );
}

/** 设置：六齿齿轮，中心圆孔。 */
function SettingsIcon() {
  return (
    <RailIcon>
      <path
        d="M10.19 5.7 10.57 2.96h2.86l.38 2.74 2.74 1.59 2.56-1.05 1.43 2.48-2.18 1.7v3.16l2.18 1.7-1.43 2.48-2.56-1.05-2.74 1.59-.38 2.74h-2.86l-.38-2.74-2.74-1.59-2.56 1.05-1.43-2.48 2.18-1.7v-3.16l-2.18-1.7 1.43-2.48 2.56 1.05 2.74-1.59Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="2.35"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </RailIcon>
  );
}

/**
 * Left icon rail: Muse Bot, sessions, automations, skills, settings.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onOpenSettings,
  activeMenu,
  onOpenSessions,
  onOpenAutomations,
  onOpenSkills,
  onOpenAssistant,
  sidebarAccessHidden = false,
}) => {
  const [assistantUnread, setAssistantUnread] = useState(false);
  useEffect(() => {
    if (activeMenu === "assistant") setAssistantUnread(false);
  }, [activeMenu]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { command?: string } | null;
      if (!data || data.command !== "assistant:chat") return;
      if (activeMenu === "assistant") return;
      setAssistantUnread(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [activeMenu]);
  const showAssistantUnread = assistantUnread && activeMenu !== "assistant";

  return (
    <div
      className="desktop-sidebar desktop-icon-rail"
      data-testid="desktop-sidebar"
      aria-hidden={sidebarAccessHidden || undefined}
      {...(sidebarAccessHidden ? ({ inert: "" } as const) : {})}
    >
      <div className="desktop-sidebar-titlebar-drag" aria-hidden="true" />
      <nav className="desktop-rail" aria-label="主导航">
        <Tooltip text="Muse Bot" position="right" wrap={false}>
          <button
            type="button"
            className={`desktop-rail-btn${activeMenu === "assistant" ? " active" : ""}`}
            onClick={() => onOpenAssistant?.()}
            aria-label="Muse Bot"
            data-testid="desktop-assistant-menu"
          >
            <MuseBotIcon />
            {showAssistantUnread ? (
              <span
                className="desktop-session-unread-dot desktop-rail-unread"
                data-testid="assistant-unread-dot"
              />
            ) : null}
          </button>
        </Tooltip>
        <Tooltip text="会话" position="right" wrap={false}>
          <button
            type="button"
            className={`desktop-rail-btn${activeMenu === "sessions" ? " active" : ""}`}
            onClick={() => onOpenSessions?.()}
            aria-label="会话"
            data-testid="desktop-sessions-menu"
          >
            <SessionsIcon />
          </button>
        </Tooltip>
        <Tooltip text="自动化" position="right" wrap={false}>
          <button
            type="button"
            className={`desktop-rail-btn${activeMenu === "automations" ? " active" : ""}`}
            onClick={() => onOpenAutomations?.()}
            aria-label="自动化"
            data-testid="desktop-automations-menu"
          >
            <AutomationsRailIcon />
          </button>
        </Tooltip>
        <Tooltip text="技能" position="right" wrap={false}>
          <button
            type="button"
            className={`desktop-rail-btn${activeMenu === "skills" ? " active" : ""}`}
            onClick={() => onOpenSkills?.()}
            aria-label="技能"
            data-testid="desktop-skills-menu"
          >
            <SkillsIcon />
          </button>
        </Tooltip>
        <Tooltip text="设置" position="right" wrap={false}>
          <button
            type="button"
            className={`desktop-rail-btn desktop-rail-settings${activeMenu === "settings" ? " active" : ""}`}
            onClick={onOpenSettings}
            aria-label="设置"
            data-testid="desktop-settings-btn"
          >
            <SettingsIcon />
          </button>
        </Tooltip>
      </nav>
    </div>
  );
};

export default DesktopSidebar;
