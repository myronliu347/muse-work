/**
 * TypeScript type definitions for the Wave AI Chat webview
 *
 * This file contains all the interfaces and types used throughout the React webview,
 * providing type safety and better development experience.
 */

// Import message structures and session types from wave-agent-sdk
import type {
  Message,
  MessageBlock,
  TextBlock,
  ErrorBlock,
  ToolBlock,
  ImageBlock,
  BangBlock,
  CompactBlock,
  ReasoningBlock,
  PermissionMode,
  AskUserQuestion,
  AskUserQuestionInput,
  AskUserQuestionOption,
  Task,
  TaskStatus,
  TaskNotificationBlock,
  McpServerStatus,
  McpServerConfig,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  SubagentConfiguration,
} from "wave-agent-sdk/dist/types/index.js";
import type {
  SessionMetadata,
  SessionData,
} from "wave-agent-sdk/dist/services/session.js";
import type { ToolBlockUpdateCallbackParams } from "wave-agent-sdk/dist/utils/messageOperations.js";

export type {
  Message,
  MessageBlock,
  TextBlock,
  ErrorBlock,
  ToolBlock,
  ImageBlock,
  BangBlock,
  CompactBlock,
  ReasoningBlock,
  TaskNotificationBlock,
  SessionData,
  SessionMetadata,
  PermissionMode,
  AskUserQuestion,
  AskUserQuestionInput,
  AskUserQuestionOption,
  Task,
  TaskStatus,
  McpServerStatus,
  McpServerConfig,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  SubagentConfiguration,
  ToolBlockUpdateCallbackParams,
};

// Slash command types
export interface SlashCommand {
  id: string;
  name: string;
  description: string;
}

// File mention types for @ file suggestion feature

/**
 * Represents a file or directory item in the suggestion dropdown
 */
export interface FileItem {
  /** Full absolute path to the file or directory */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** File or directory name without path */
  name: string;
  /** File extension (without dot) - empty string for directories */
  extension: string;
  /** VS Code file icon class name */
  icon: string;
  /** Flag to distinguish files vs directories */
  isDirectory: boolean;
}

/**
 * State for file mention suggestions
 */
export interface FileSuggestionState {
  /** Whether the file mention dropdown is active */
  isActive: boolean;
  /** Array of file suggestions to display */
  suggestions: FileItem[];
  /** Currently selected suggestion index */
  selectedIndex: number;
  /** Text being typed after @ symbol for filtering */
  filterText: string;
  /** Position for dropdown placement */
  position: { top: number; left: number };
  /** Loading state for API requests */
  isLoading: boolean;
}

// VS Code API type

/**
 * Interface for the VS Code webview API
 */
export interface VsCodeApi {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

// Host-injected globals. Declared here (not in index.tsx) so the augmentation
// reaches every compilation unit that imports types — the tests tsconfig only
// pulls in src files reachable from test imports, never index.tsx itself.
declare global {
  interface Window {
    /** Provided by the Electron preload (and the VS Code webview runtime). */
    acquireVsCodeApi(): VsCodeApi;
    /** Set by the Electron preload (packages/desktop). */
    waveHostType?: string;
    /** file:// URL of the element-picker preload, exposed by the Electron preload. */
    wavePickerPreloadPath?: string;
    /**
     * Desktop Electron 32+: map a clipboard/drop File to an absolute path
     * (replaces removed File.path). Undefined on non-desktop hosts.
     */
    museGetPathForFile?: (file: File) => string;
  }
}

// VS Code webview message types

/**
 * Base interface for messages sent between webview and host
 */
export interface WebviewMessage {
  /** Command identifier */
  command: string;
  /** Additional command parameters */
  [key: string]: unknown;
}

// Component props
export interface ChatAppProps {
  vscode: VsCodeApi;
  host?: DesktopHostProps;
  /**
   * Desktop split-view: the paneId this instance renders. When set, the message
   * listener filters host pushes by paneId and outgoing commands carry it back.
   * Undefined for a single-pane desktop layout.
   */
  paneId?: string;
}

/**
 * One split-view pane in the desktop layout (FR-032). Panes are organized into
 * at most two rows (top/bottom); within a row order = left→right. `sessionId`
 * is undefined while the pane's session is still being resolved.
 */
export interface DesktopPane {
  paneId: string;
  sessionId?: string;
  /**
   * Host this pane is bound to ('local' or an SSH host name), pushed via
   * `desktopPanes`. Drives per-pane remote behavior (panels off, localhost
   * links to the system browser).
   */
  host?: string;
  /**
   * Width ratio across the pane row (0–1), maintained by the host. Absent
   * means the pane takes an equal share of the row.
   */
  width?: number;
  /** Pane row: 0 = top (default when absent), 1 = bottom. */
  row?: 0 | 1;
}

/** Options for opening a session in a new pane. */
export interface OpenPaneOptions {
  /** Gap index (0..target-row pane count) to insert at — from a sidebar drop. */
  insertionIndex?: number;
  /** Target row; default is the focused pane's row. */
  row?: 0 | 1;
  /**
   * Split the single row into two and put the new pane alone in the fresh
   * row ('above' = new row on top). Ignored when two rows already exist.
   */
  newRow?: "above" | "below";
}

// Desktop host support — injected when running inside packages/desktop (Electron).
// DesktopApp is the single root for the desktop host.
export interface DesktopHostProps {
  type: "desktop";
  /** Current host (local-only for now; kept for pane/workdir scoping). */
  host: string;
  workdir?: string;
  recentWorkdirs: string[];
  onSelectWorkdir: () => void;
  /** `host` scopes the recents lookup to a specific host (defaults to the current one). */
  onSelectRecentWorkdir: (path: string, host?: string) => void;
  onRemoveRecentWorkdir: (path: string, host?: string) => void;
  /**
   * Sidebar session tree (FR-020): one group per recent directory with all of
   * its sessions. Pushed via the `desktopSessionTree` message.
   */
  sessionTree: DesktopSessionGroup[];
  /** Open a historical session; switches workdir first when needed. */
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index; also removes worktree+branch if applicable. */
  onDeleteSession: (sessionId: string) => void;
  /** Toggle pin membership for a sidebar session. */
  onTogglePin: (sessionId: string, pinned: boolean) => void;
  /** Rename a sidebar session title. */
  onRenameSession: (sessionId: string, title: string) => void;
  /**
   * Open a session in a new pane (Cmd/Ctrl+Click on a sidebar session, or drag
   * one into the chat area). When the session is already shown, the host
   * focuses that pane instead. `opts` picks the target row / insertion gap /
   * a fresh second row; omitted options mean "append at the right end of the
   * focused pane's row".
   */
  onOpenPane: (
    workdir: string,
    sessionId: string,
    opts?: OpenPaneOptions,
  ) => void;
  /**
   * Split-view panes (FR-032) grouped into up to two rows, pushed via
   * `desktopPanes`. Empty until the first layout push; the layout renders a
   * single pane in that case.
   */
  panes?: DesktopPane[];
  /**
   * Row height ratios [top, bottom] (sum ≈ 1), pushed via `desktopPanes`.
   * Present only while two rows exist; absent = single row fills the area.
   */
  rowHeights?: number[];
  /** The pane that receives sidebar clicks / 新对话, pushed via `desktopPanes`. */
  focusedPaneId?: string | null;
}

/** One directory group in the desktop sidebar session tree (FR-020). */
export interface DesktopSessionGroup {
  /** Host the group's sessions run on ('local' or an SSH host name) — the group key is (host, workdir). */
  host: string;
  workdir: string;
  sessions: DesktopSessionEntry[];
}

/** A session in the desktop sidebar tree, derived from the session index (FR-024). */
export interface DesktopSessionEntry {
  sessionId: string;
  title: string;
  lastActiveAt: number;
  /** Absolute workdir shown as subtitle in the pin/recent sidebar. */
  workdir?: string;
  /** True when this session lives in a worktree (delete also cleans up branch+dir). */
  hasWorktree: boolean;
  /** Worktree slug under `.wave/worktrees/<name>` when isolated. */
  worktreeName?: string;
  /** Branch created for the worktree (e.g. `worktree-<name>`). */
  worktreeBranch?: string;
  /** True while this session is generating — drives the per-session running dot (FR-031). */
  running?: boolean;
  /** True while a confirmation request (tool/plan/question) awaits the user — drives the waiting dot. */
  waitingConfirmation?: boolean;
  /** Whether the session is in the pin group. */
  pinned?: boolean;
  /** Non-focus session finished a turn — drives the unread-done dot. */
  unreadDone?: boolean;
}

export type EffectiveTheme = "light" | "dark";
export type ThemePreference = "system" | "light" | "dark";
/** Radix Theme `scaling` — scales --space-* and --font-size-* together. */
export type ThemeScaling = "90%" | "95%" | "100%" | "105%" | "110%";
/** Radix Theme `accentColor`. */
export type ThemeAccentColor =
  | "gray"
  | "gold"
  | "bronze"
  | "brown"
  | "yellow"
  | "amber"
  | "orange"
  | "tomato"
  | "red"
  | "ruby"
  | "crimson"
  | "pink"
  | "plum"
  | "purple"
  | "violet"
  | "iris"
  | "indigo"
  | "blue"
  | "cyan"
  | "teal"
  | "jade"
  | "green"
  | "grass"
  | "lime"
  | "mint"
  | "sky";
/** Radix Theme `radius`. */
export type ThemeRadius = "none" | "small" | "medium" | "large" | "full";
/** Radix Theme `grayColor`. */
export type ThemeGrayColor =
  | "auto"
  | "gray"
  | "mauve"
  | "slate"
  | "sage"
  | "olive"
  | "sand";

export interface ThemeState {
  /** Present only when the in-app store owns the snapshot; host IPC may omit it. */
  preference?: ThemePreference;
  effective: EffectiveTheme;
}

/** Action a toast's button triggers when clicked (host-side semantics). */
export type ToastAction =
  | { type: "quitAndInstall" }
  | { type: "openDownloadPage"; url: string };

/** A non-modal in-app toast (VS Code-style, bottom-right). Desktop host only. */
export interface UpdateToast {
  id: string;
  message: string;
  actionLabel?: string;
  action?: ToastAction;
}

// Pushed by the desktop main process in response to `desktopReady` and after
// every workdir/host change (message command: 'desktopWorkdirState').
export interface DesktopWorkdirState {
  workdir?: string;
  /** Current host — the focused pane's host (local-only for now). */
  host: string;
  recentWorkdirs: string[];
}

export interface MessageListProps {
  messages: Message[];
  queuedMessages?: QueuedMessage[];
  isStreaming?: boolean;
  isCompacting?: boolean;
  vscode: VsCodeApi;
  onRewindToMessage?: (messageId: string) => void;
  workdir?: string;
  /** Desktop host only: open a localhost URL in the preview pane. */
  onOpenPreview?: (url: string) => void;
  /** Desktop host only: open a file in the file panel instead of the OS. */
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
  /** Open the nested Agent tool transcript popup. */
  onOpenAgentTranscript?: (toolBlock: ToolBlock) => void;
}

export interface MessageProps {
  message: Message;
  isQueued?: boolean;
  vscode: VsCodeApi;
  onRewindToMessage?: (messageId: string) => void;
  workdir?: string;
  /** Desktop host only: open a localhost URL in the preview pane. */
  onOpenPreview?: (url: string) => void;
  /** Desktop host only: open a file in the file panel instead of the OS. */
  onOpenFile?: (path: string, startLine?: number, endLine?: number) => void;
  /** Open the nested Agent tool transcript popup. */
  onOpenAgentTranscript?: (toolBlock: ToolBlock) => void;
  /**
   * Assistant turn collapse helpers:
   * - all: default
   * - omitFinalText: hide the group's last non-empty text block (shown outside)
   * - finalTextOnly: render only that last text block
   */
  blockRenderMode?: "all" | "omitFinalText" | "finalTextOnly";
  /** Block index of the group's final text within this message (when collapsing). */
  finalTextBlockIndex?: number;
}

// Image attachment types (uses base64 data directly)
export interface AttachedImage {
  /** Unique identifier for the image (for UI management) */
  id: string;
  /** Base64 data URL (e.g., "data:image/png;base64,iVBORw0...") */
  data: string;
  /** MIME type of the image */
  mimeType: string;
  /** Original filename if available */
  filename?: string;
  /** File size in bytes */
  size?: number;
}

export interface MessageInputProps {
  onSendMessage: (
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  isStreaming: boolean;
  onAbortMessage: () => void;
  onSubmitQueuedEdit?: (
    id: string,
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
  ) => void;
  editingQueuedId?: string | null;
  onCancelQueuedEdit?: () => void;
  shouldClearInput?: boolean;
  onInputCleared?: () => void;
  vscode: VsCodeApi;
  // Selection props
  selection?: SelectionInfo;
  inputContent?: string;
  /**
   * The session this input belongs to. Tagged on every updateInputContent so
   * the host routes drafts per conversation; on change the input flushes the
   * outgoing session's draft and applies the incoming one.
   */
  sessionId?: string;
  permissionMode?: PermissionMode;
  initialAttachedImages?: AttachedImage[];
  /** Optional slot rendered at the top-left of the input box (desktop workdir selector). */
  workdirSelector?: React.ReactNode;
  /** Optional /rewind popup rendered above the input box, anchored to .input-wrapper. */
  rewindPopup?: React.ReactNode;
  /** Optional /model popup rendered above the input box, anchored to .input-wrapper. */
  modelPopup?: React.ReactNode;
  /** Optional /btw side-question panel rendered above the input box, anchored to .input-wrapper. */
  btwPopup?: React.ReactNode;
  /** Disable the whole input area (e.g. desktop host without a workdir). */
  disabled?: boolean;
  /** Per-session model id shown in the sender toolbar. */
  modelId?: string;
  /** Called when the user picks a model in the sender toolbar. */
  onModelChange?: (modelId: string) => void;
  /** Optional MuseApiClient for the embedded model select (tests / injection). */
  modelSelectApi?: import("../muse/apiClient").MuseApiClient;
  /** Absolute workdir for @ file mentions (desktop). */
  workdir?: string;
}

/**
 * Props for the attached images component
 */
export interface AttachedImagesProps {
  images: AttachedImage[];
  onRemove: (imageId: string) => void;
}

/**
 * Props for the file suggestion dropdown component
 */
export interface FileSuggestionDropdownProps {
  suggestions: FileItem[];
  isVisible: boolean;
  selectedIndex: number;
  onSelect: (file: FileItem) => void;
  onClose: () => void;
  position: { top: number; left: number };
  filterText: string;
  isLoading?: boolean;
  browsePath?: string;
  onEnterDirectory?: (file: FileItem) => void;
  onBrowseTo?: (path: string) => void;
}

/** Desktop conversation-level side panels (desktop-only). */
export type DesktopPanelKind = "preview" | "diff" | "terminal" | "file";

/**
 * State of the desktop file panel (one per conversation): which file is open,
 * its content, and read status. The host pushes a snapshot after every
 * openFile request via the `desktopFileContent` message; `loading` is set
 * locally when the panel opens and cleared/overwritten when the reply lands.
 */
export interface FileViewState {
  /** Absolute path of the file being viewed. */
  path: string;
  /** 'local' or the SSH host name the file lives on. */
  host: string;
  /** True while the host is reading the file (nothing loaded yet). */
  loading?: boolean;
  /** User-facing error when the file could not be read (no content). */
  error?: string;
  /** Present when the file cannot be rendered (binary or over size cap). */
  unsupported?: "binary" | "too-large";
  /** On-disk size when known (e.g. unsupported too-large). */
  sizeBytes?: number;
  /** File content, present for text/markdown files. */
  content?: string;
  /** Lines to jump to (1-based) — from read tool offset/limit or a selection. */
  startLine?: number;
  endLine?: number;
  /** Text read was truncated (line or byte cap). */
  truncated?: boolean;
  /** Total line count on disk, for the truncated hint. */
  totalLines?: number;
  /** Base64 data URL for remote images, inlined in the panel. */
  imageBase64?: string;
}

/** One directory entry from desktopListDir. */
export type FileTreeDirEntry = {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
};

/** Per-workdir file tree UI state (panel group scoped). */
export type FileTreeState = {
  /** Expanded directory relative paths ("" is root listing key). */
  expanded: string[];
  /** Currently selected file absolute path. */
  selected?: string;
  /** Tree column width in px. */
  width: number;
  /** Cached list results keyed by relative dir ("" = workdir root). */
  childrenCache: Record<string, FileTreeDirEntry[]>;
  /** When true, the tree column is collapsed to a slim rail. Default true. */
  collapsed: boolean;
};

export type FileSidebarMode = "tree" | "search";

export type ContentSearchMatch = {
  line: number;
  text: string;
  startCol: number;
  endCol: number;
};

export type ContentSearchFileHit = {
  path: string;
  relativePath: string;
  matches: ContentSearchMatch[];
};

export type ContentSearchState = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  results: ContentSearchFileHit[];
  expandedFiles: string[];
  loading: boolean;
  error?: string;
  truncated?: boolean;
  requestId?: string;
};

/** Header / dock control: show or hide the entire right dock. */
export interface PanelToggleProps {
  onToggleDock: () => void;
}

export interface ChatHeaderProps {
  onNewSession: () => void;
  newSessionDisabled?: boolean;
  onAbortMessage: () => void;
  messages: Message[];
  currentSession?: SessionMetadata;
  onOpenSettings: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  // Desktop host: session new/list buttons live in DesktopSidebar instead.
  hideSessionButtons?: boolean;
  // Desktop host: the more button + menu live in DesktopSidebar instead.
  hideMoreButton?: boolean;
  // Desktop host: conversation-level panel toggle (preview/diff/terminal).
  panelToggle?: PanelToggleProps;
  /** Desktop: read-only branch / worktree badge in the title bar. */
  gitContext?: { branch?: string; worktreeName?: string };
}

// Matches wave-agent-sdk's QueuedMessage type
export interface QueuedMessage {
  id?: string;
  type?: "message" | "bang";
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  longTextMap?: Record<string, string>;
  // Legacy alias for backward compat
  text?: string;
}

export interface QueuedMessageListProps {
  queuedMessages: QueuedMessage[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  editingQueuedId: string | null;
  vscode: VsCodeApi;
}

// Chat state management
export interface ChatState {
  messages: Message[];
  tasks: Task[];
  backgroundTasks: BackgroundTaskSummary[];
  workflowRuns: SerializableWorkflowRun[];
  isTaskListCollapsed: boolean;
  isQueueCollapsed: boolean;
  editingQueuedId: string | null;
  isStreaming: boolean;
  // Compaction in progress — shows the "正在压缩对话…" hint after the blinking
  // cursor at the end of the message list.
  isCompacting: boolean;
  // Session restore in progress (desktop): the pane switched optimistically to
  // the target session and shows the sweep loading animation over the message
  // + input area while the host connects and replays the transcript.
  isRestoring: boolean;
  isCommandRunning: boolean;
  shouldClearInput: boolean;
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  sessionsLoading: boolean;
  pendingConfirmations: ConfirmationRequest[];
  queuedMessages: QueuedMessage[];
  // Auth state
  isAuthenticated: boolean;
  // Whether the initial state (incl. auth status) has been received from the
  // backend. The welcome page is withheld until this is true so the login CTA
  // doesn't flash for logged-in users before setInitialState arrives.
  initialized: boolean;
  // Agent working directory, used to render tool file paths as relative.
  workdir?: string;
  /** Nested transcripts keyed by subagent id (Agent tool popup). */
  subagentMessages: Record<string, Message[]>;
  /** Agent tool block id → live subagent UUID. */
  agentToolSubagentIds: Record<string, string>;
  pendingAgentToolIds: string[];
  unboundSubagentIds: string[];
  // Dialog state
  activeDialog:
    | "config"
    | "plugin"
    | "mcp"
    | "status"
    | "tasks"
    | "workflows"
    | "agents"
    | "login"
    | null;
  /** Login failure shown inside the auth dialog (CodeMaker SSO). */
  loginError?: string;
  configurationData?: ConfigurationData;
  configurationLoading: boolean;
  configurationError?: string;
  // Project-scoped settings (read from .wave/settings.json merged config via
  // stdio RPC). Holds the merged enabledPlugins map for the 项目设置 tab.
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  // Permission mode state
  permissionMode?: PermissionMode;
  // Attached images state
  attachedImages?: AttachedImage[];
  // Input state
  inputContent?: string;
  // Selection state
  selection?: SelectionInfo;
  // Desktop theme state (only set inside the desktop host)
  theme?: ThemeState;
}

export interface ConfirmationRequest {
  confirmationId: string;
  toolName: string;
  confirmationType: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  permissionMode?: PermissionMode;
  warning?: string;
}

export interface ConfirmationDecision {
  behavior: "allow" | "deny";
  newPermissionMode?: string;
  newPermissionRule?: string;
  message?: string;
}

export interface ConfirmationDialogProps {
  confirmation: ConfirmationRequest;
  onConfirm: (confirmationId: string, decision?: ConfirmationDecision) => void;
  onReject: (confirmationId: string) => void;
}

// Configuration management types

/**
 * Configuration data for AI agent settings
 * Maps to VS Code global state
 */
export interface ConfigurationData {
  /** API key for authentication */
  apiKey?: string;
  /** Headers for authentication */
  headers?: string;
  /** Base URL for API endpoints */
  baseURL?: string;
  /** Primary model */
  model?: string;
  /** Fast model for quick responses */
  fastModel?: string;
  /** Preferred language for agent communication */
  language?: string;
  /** CodeChat server URL (reported by SDK, used for update checks) */
  serverUrl?: string;
}

// Plugin related types
export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  installed?: boolean;
  marketplace?: string;
  scope?: PluginScope;
}

export interface MarketplaceInfo {
  name: string;
  url: string;
}

export type PluginScope = "user" | "project" | "local";

export interface SelectionInfo {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  selectedText: string;
  isEmpty: boolean;
}

/**
 * Props for the general settings dialog component
 */
export interface ConfigDialogProps {
  configurationData: ConfigurationData;
  isLoading: boolean;
  error?: string;
  onSave: (config: ConfigurationData) => void;
  onCancel: () => void;
  projectSettings?: { enabledPlugins: Record<string, boolean> };
  onLoadProjectSettings?: () => void;
  onToggleBuiltinPlugin?: (pluginId: string, enabled: boolean) => void;
}

/**
 * Props for the plugin management dialog component
 */
export interface PluginDialogProps {
  onClose: () => void;
}

/**
 * Props for the MCP server settings dialog component
 */
export interface McpDialogProps {
  onClose: () => void;
}

/**
 * Props for the status info dialog component
 */
export interface StatusDialogProps {
  onClose: () => void;
}

export interface BackgroundTaskManagerProps {
  onClose: () => void;
}

/**
 * Props for the agent definitions dialog component
 */
export interface AgentsDialogProps {
  onClose: () => void;
}

export interface WorkflowManagerProps {
  onCancel: () => void;
}

export type ChatAction =
  | { type: "SET_MESSAGES"; payload: Message[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_BACKGROUND_TASKS"; payload: BackgroundTaskSummary[] }
  | { type: "SET_WORKFLOW_RUNS"; payload: SerializableWorkflowRun[] }
  | { type: "TOGGLE_TASK_LIST_COLLAPSE" }
  | { type: "SET_TASK_LIST_COLLAPSED"; payload: boolean }
  | { type: "TOGGLE_QUEUE_COLLAPSE" }
  | { type: "START_STREAMING" }
  | { type: "END_STREAMING" }
  | { type: "SET_COMPACTING"; payload: boolean }
  | { type: "INPUT_CLEARED" }
  | { type: "SET_SESSIONS"; payload: SessionMetadata[] }
  | { type: "SET_CURRENT_SESSION"; payload: SessionMetadata | undefined }
  | { type: "SET_SESSIONS_LOADING"; payload: boolean }
  | { type: "SHOW_CONFIRMATION"; payload: ConfirmationRequest }
  | { type: "HIDE_CONFIRMATION"; payload: string }
  | {
      type: "SHOW_DIALOG";
      payload: {
        type:
          | "config"
          | "plugin"
          | "mcp"
          | "status"
          | "tasks"
          | "workflows"
          | "agents"
          | "login";
        data?: ConfigurationData;
        error?: string;
      };
    }
  | { type: "HIDE_DIALOG" }
  | { type: "SET_AUTHENTICATED"; payload: boolean }
  | { type: "SET_LOGIN_ERROR"; payload: string | undefined }
  | { type: "SET_CONFIGURATION_LOADING"; payload: boolean }
  | { type: "SET_CONFIGURATION_ERROR"; payload: string | undefined }
  | { type: "SET_CONFIGURATION_DATA"; payload: ConfigurationData }
  | {
      type: "SET_PROJECT_SETTINGS";
      payload: { enabledPlugins: Record<string, boolean> };
    }
  | { type: "UPDATE_SELECTION"; payload: SelectionInfo | undefined }
  | { type: "SET_PERMISSION_MODE"; payload: PermissionMode }
  | { type: "SET_COMMAND_RUNNING"; payload: boolean }
  | { type: "SET_WORKDIR"; payload: string }
  | { type: "SET_QUEUED_MESSAGES"; payload: QueuedMessage[] }
  | { type: "SET_EDITING_QUEUED_ID"; payload: string | null }
  | {
      type: "SET_INITIAL_STATE";
      payload: {
        messages: Message[];
        tasks?: Task[];
        isStreaming: boolean;
        isCommandRunning?: boolean;
        isCompacting?: boolean;
        isRestoring?: boolean;
        isTaskListCollapsed?: boolean;
        sessions: SessionMetadata[];
        currentSession?: SessionMetadata;
        configurationData: ConfigurationData;
        pendingConfirmations: ConfirmationRequest[];
        selection?: SelectionInfo;
        inputContent?: string;
        permissionMode?: PermissionMode;
        attachedImages?: AttachedImage[];
        queuedMessages?: QueuedMessage[];
        isAuthenticated?: boolean;
        workdir?: string;
        backgroundTasks?: BackgroundTaskSummary[];
        workflowRuns?: SerializableWorkflowRun[];
        theme?: ThemeState;
      };
    }
  // Incremental update actions for streaming optimization
  | { type: "APPEND_MESSAGE"; payload: Message }
  | {
      type: "UPDATE_STREAMING_CONTENT";
      payload: { messageId: string; chunk: string; stage: "streaming" | "end" };
    }
  | {
      type: "UPDATE_STREAMING_REASONING";
      payload: { messageId: string; chunk: string; stage: "streaming" | "end" };
    }
  | { type: "UPDATE_TOOL_BLOCK"; payload: ToolBlockUpdateCallbackParams }
  | { type: "APPEND_ERROR_BLOCK"; payload: { error: string } }
    | {
        type: "SET_SUBAGENT_MESSAGES";
        payload: { subagentId: string; messages: Message[] };
      }
    | {
        type: "APPEND_SUBAGENT_MESSAGE";
      payload: { subagentId: string; messageId: string };
    }
  | {
      type: "UPDATE_SUBAGENT_STREAMING_CONTENT";
      payload: {
        subagentId: string;
        messageId: string;
        chunk: string;
        stage: "streaming" | "end";
      };
    }
  | {
      type: "UPDATE_SUBAGENT_TOOL_BLOCK";
      payload: {
        subagentId: string;
        params: ToolBlockUpdateCallbackParams;
      };
    }
  // Bang message incremental updates (keyed by messageId). The bang block is
  // constructed in the reducer because it needs a Message wrapper (id/timestamp).
  | {
      type: "APPEND_BANG_MESSAGE";
      payload: { command: string; messageId: string };
    }
  | {
      type: "UPDATE_BANG_MESSAGE";
      payload: { command: string; output: string; messageId: string };
    }
  | {
      type: "COMPLETE_BANG_MESSAGE";
      payload: {
        command: string;
        exitCode: number;
        messageId: string;
        output?: string;
      };
    };
