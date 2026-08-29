import type { VsCodeApi } from "../../types";
import type { MuseApiClient, MuseSession, MuseSessionsGrouped } from "../apiClient.js";
import type { MuseWsClient, MuseWsEvent } from "../wsClient.js";
import { postToWebview } from "./utils.js";
import type { PendingPermission, TreeSession } from "./utils.js";

export interface HostBridgeOptions {
  api: MuseApiClient;
  ws: MuseWsClient;
  /** Default workdir for createSession */
  workdir?: string;
  /** Optional outer host API for unhandled commands */
  outer?: VsCodeApi;
  openExternal?: (url: string) => void;
}

export type WorkdirStatePatch = {
  workdir?: string | null;
  recentWorkdirs?: string[];
  clearSession?: boolean;
  /** When true, clear current workdir (new-session default). */
  clearWorkdir?: boolean;
};

export type PendingWorktree = {
  text: string;
  images?: unknown;
  resolve: (value: {
    ok: true;
    name: string;
    path: string;
    branch: string;
    baseBranch: string;
    repoRoot: string;
  } | { ok: false; error: string }) => void;
};

/**
 * Bridge context: all mutable bridge state plus the cross-domain registration
 * points. The state fields are initialized by createBridgeCtx; the handler
 * registration points are wired by createHostBridge (index) after assembling
 * the domain modules, so no module imports another module.
 */
export interface BridgeCtx {
  api: MuseApiClient;
  ws: MuseWsClient;
  outer: VsCodeApi | undefined;
  openExternal: (url: string) => void;
  postToWebview: (data: Record<string, unknown>) => void;

  // State (originally the 216-528 closure block of the monolithic factory).
  currentWorkdir: string;
  recentWorkdirs: string[];
  sessionId: string | null;
  /** True after「新对话」until the first send creates a real session. */
  pendingNewSession: boolean;
  /**
   * When true, ignore Electron `desktopWorkdirState` workdir pushes so a
   * persisted last-folder cannot overwrite the new-session null default.
   * Cleared when the user explicitly picks a folder/recent.
   */
  suppressWorkdirPush: boolean;
  draftModel: string | undefined;
  draftAgent: string | undefined;
  draftPermissionMode: "acceptEdits" | "bypassPermissions";
  streamingMessageId: string | null;
  knownAssistantIds: Set<string>;
  state: unknown;
  bootstrapped: boolean;
  loading: boolean;
  /**
   * True after a user abort until the next turn starts. In-flight WS deltas
   * that were sent before the abort can arrive after handleAbortMessage
   * optimistically resets loading/streamingMessageId — without this guard the
   * first such delta re-ignites startStreaming (stop button flickers back) and
   * re-appends a duplicate assistant message (knownAssistantIds was cleared).
   */
  aborted: boolean;
  latestTokens: number;
  wsConnected: boolean;
  toastedInterrupted: boolean;
  wsEverOpened: boolean;
  /** Active provider id (from /auth/status); gates the CodeMaker login dialog. */
  activeProviderId: string | undefined;
  pinned: TreeSession[];
  recent: TreeSession[];
  /** Todo 分组（规划会话 + 执行会话），来自 grouped 响应的 todoGroups。 */
  todoGroups: NonNullable<MuseSessionsGrouped["todoGroups"]>;
  titledSessions: Set<string>;
  /** Cached permission:request for non-focus (and active) sessions until responded/disposed. */
  pendingPermissions: Map<string, PendingPermission>;
  /** Sessions whose SDK currently reports isCompacting. Used so a session switch
   *  does not leak the hint, and switching back restores it if still compacting. */
  compactingSessions: Set<string>;
  runningWorkBySession: Map<
    string,
    { tasks: boolean; workflows: boolean }
  >;
  pendingWorktrees: Map<string, PendingWorktree>;

  // State-derived helpers (moved from the monolithic closure).
  treeById: () => Map<string, TreeSession>;
  publishAgentBusy: () => void;
  setLoading: (next: boolean) => void;
  ensureWs: () => Promise<void>;

  // Cross-domain registration points, wired by createHostBridge (index.ts)
  // after assembling the domain modules. Static imports stay acyclic.
  emitChatWs: (event: MuseWsEvent) => void;
  activateSession: (id: string) => Promise<MuseSession>;
  handleSendMessage: (msg: { text?: string; images?: unknown }) => Promise<void>;
  handleAbortMessage: () => Promise<void>;
  resetChatStreaming: () => void;
  patchTreeSession: (id: string, patch: Partial<TreeSession>) => void;
  refreshTree: () => Promise<MuseSessionsGrouped>;
  loadMessages: (id: string) => Promise<void>;
  applyGrouped: (grouped: MuseSessionsGrouped) => void;
  emitCurrentSession: (session: MuseSession) => void;
  emitWorkdirState: (patch?: WorkdirStatePatch) => void;
  rememberRecentWorkdir: (path: string) => void;
  handleDesktopCreateWorktree: (msg: {
    workdir?: string;
    baseBranch?: string;
    name?: string;
    text?: string;
    images?: unknown;
  }) => Promise<void>;
  refreshAuth: () => Promise<void>;
  maybePromptAuthDialog: (error: string) => void;
  maybePatchTitle: (sid: string, text: string) => void;
  normalizeOutboundImages: (raw: unknown) => Array<{ data: string; mediaType: string }>;
  pushSessionControlState: (id: string) => Promise<void>;
  setRunningWork: (id: string, kind: "tasks" | "workflows", items: unknown) => void;
  showPermissionConfirmation: (pending: PendingPermission) => void;
  clearPendingPermission: (id: string) => void;
  resyncAfterReconnect: () => Promise<void>;
}

export function createBridgeCtx(opts: HostBridgeOptions): BridgeCtx {
  const { api, ws } = opts;
  const openExternal =
    opts.openExternal ??
    ((url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    });

  const ctx: BridgeCtx = {
    api,
    ws,
    outer: opts.outer,
    openExternal,
    postToWebview,

    currentWorkdir: opts.workdir ?? "/",
    recentWorkdirs: [],
    sessionId: null,
    pendingNewSession: false,
    suppressWorkdirPush: false,
    draftModel: undefined,
    draftAgent: undefined,
    draftPermissionMode: "acceptEdits",
    streamingMessageId: null,
    knownAssistantIds: new Set<string>(),
    state: null,
    bootstrapped: false,
    loading: false,
    aborted: false,
    latestTokens: 0,
    wsConnected: false,
    toastedInterrupted: false,
    wsEverOpened: false,
    activeProviderId: undefined,
    pinned: [],
    recent: [],
    todoGroups: [],
    titledSessions: new Set<string>(),
    pendingPermissions: new Map<string, PendingPermission>(),
    compactingSessions: new Set<string>(),
    runningWorkBySession: new Map<string, { tasks: boolean; workflows: boolean }>(),
    pendingWorktrees: new Map<string, PendingWorktree>(),

    treeById(): Map<string, TreeSession> {
      const map = new Map<string, TreeSession>();
      for (const s of ctx.pinned) map.set(s.id, s);
      for (const s of ctx.recent) map.set(s.id, s);
      for (const g of ctx.todoGroups) for (const s of g.sessions) map.set(s.id, s);
      return map;
    },

    publishAgentBusy(): void {
      const anyRunning =
        ctx.loading ||
        ctx.pinned.some((s) => s.running) ||
        ctx.recent.some((s) => s.running) ||
        [...ctx.runningWorkBySession.values()].some(
          (flags) => flags.tasks || flags.workflows,
        );
      ctx.outer?.postMessage({
        command: "desktopAgentBusy",
        busy: anyRunning,
      });
    },

    setLoading(next: boolean): void {
      ctx.loading = next;
      ctx.publishAgentBusy();
    },

    async ensureWs(): Promise<void> {
      if (ctx.wsConnected) {
        await ctx.ws.connect("*");
        return;
      }
      await ctx.ws.connect("*");
      ctx.wsConnected = true;
    },

    // Cross-domain registration points are assigned by createHostBridge
    // (index.ts) after module assembly. Unwired access only happens at runtime
    // after createHostBridge returns, when wiring is complete.
  } as unknown as BridgeCtx;

  return ctx;
}
