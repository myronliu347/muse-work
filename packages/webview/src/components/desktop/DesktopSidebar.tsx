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
  /** SSO from the sidebar footer (next to settings). */
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

/** 灵光：按产品 logo 描的坐姿猫，面前一台电脑。黑耳朵、尾巴尖和眼睛留空。 */
function MuseBotIcon() {
  const cat =
    "M 17.71 1.57 Q 18.20 2.17 18.20 4.48 Q 18.20 6.79 18.88 8.20 Q 19.57 9.62 19.26 9.91 Q 18.95 10.21 19.19 10.58 Q 19.44 10.96 18.76 11.78 Q 18.08 12.60 19.26 14.61 Q 20.43 16.62 20.68 18.18 Q 20.93 19.75 21.30 19.08 Q 21.67 18.41 21.30 15.58 Q 20.93 12.74 21.43 12.07 Q 21.92 11.40 22.48 11.63 Q 23.04 11.85 22.60 13.04 Q 22.17 14.23 22.48 16.84 Q 22.79 19.45 22.23 20.34 Q 21.67 21.24 20.56 21.91 Q 19.44 22.58 17.64 22.88 Q 15.84 23.17 14.60 22.43 Q 13.36 21.68 14.17 21.46 Q 14.98 21.24 15.10 20.72 Q 15.22 20.19 13.43 20.12 Q 11.63 20.05 11.75 19.00 Q 11.88 17.96 10.88 18.63 Q 9.89 19.30 10.08 20.79 Q 10.26 22.28 9.15 17.81 Q 8.03 13.34 4.62 12.74 Q 1.21 12.15 4.74 12.67 Q 8.28 13.19 8.96 15.05 Q 9.64 16.92 10.33 15.58 Q 11.01 14.23 10.02 13.64 Q 9.02 13.04 8.34 12.07 Q 7.66 11.11 7.54 10.51 Q 7.41 9.91 7.91 8.50 Q 8.40 7.08 8.16 4.40 Q 7.91 1.72 8.59 1.64 Q 9.27 1.57 10.39 2.54 Q 11.50 3.51 13.12 3.43 Q 14.73 3.36 15.91 2.24 Q 17.08 1.12 17.15 1.05 Q 17.21 0.97 17.71 1.57 Z";
  const ear =
    "M 17.71 1.57 Q 18.20 2.17 18.33 4.85 Q 18.45 7.53 17.08 6.86 Q 15.72 6.19 15.10 5.22 Q 14.48 4.25 15.78 2.69 Q 17.08 1.12 17.15 1.05 Q 17.21 0.97 17.71 1.57 Z";
  const tail =
    "M 22.29 11.40 Q 22.67 11.40 22.91 11.78 Q 23.16 12.15 22.67 13.12 Q 22.17 14.09 21.55 13.86 Q 20.93 13.64 21.36 12.60 Q 21.80 11.55 21.86 11.48 Q 21.92 11.40 22.29 11.40 Z";
  const laptop =
    "M 4.56 12.89 Q 8.03 13.49 9.15 17.96 Q 10.26 22.43 10.14 20.87 Q 10.02 19.30 10.70 19.30 Q 11.38 19.30 11.88 19.90 Q 12.37 20.49 13.55 20.34 Q 14.73 20.19 14.98 20.49 Q 15.22 20.79 12.81 21.76 Q 10.39 22.73 6.85 21.76 Q 3.32 20.79 2.95 20.27 Q 2.57 19.75 1.77 16.10 Q 0.96 12.45 1.02 12.37 Q 1.09 12.30 4.56 12.89 Z";
  const eyes =
    "M 9.64 10.14 Q 10.39 10.21 10.08 10.66 Q 9.77 11.11 9.33 10.58 Q 8.90 10.06 9.64 10.06 Q 10.39 10.06 10.08 10.58 Q 9.77 11.11 9.40 10.58 Q 9.02 10.06 8.96 10.06 Q 8.90 10.06 9.64 10.14 Z M 13.92 10.21 Q 14.85 10.21 14.36 10.81 Q 13.86 11.40 13.43 10.88 Q 12.99 10.36 12.99 10.29 Q 12.99 10.21 13.92 10.21 Z";
  return (
    <RailIcon>
      <path fill="currentColor" fillRule="evenodd" d={`${cat} ${ear} ${tail} ${eyes}`} />
      <path d={ear} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d={tail} stroke="currentColor" strokeWidth="1.15" />
      <path d={laptop} stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </RailIcon>
  );
}

/** 会话：圆气泡，里面两行字。 */
function SessionsIcon() {
  return (
    <RailIcon>
      <path
        d="M12 4.8c-3.9 0-7 2.5-7 5.7 0 1.8 1 3.4 2.6 4.4l-.7 2.9 3-1.5c.7.2 1.4.3 2.1.3 3.9 0 7-2.5 7-5.7s-3.1-5.7-7-5.7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.7 9.6h6.6M8.7 12.4h4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
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
        <Tooltip text="灵光" position="right" wrap={false}>
          <button
            type="button"
            className={`desktop-rail-btn${activeMenu === "assistant" ? " active" : ""}`}
            onClick={() => onOpenAssistant?.()}
            aria-label="灵光"
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
