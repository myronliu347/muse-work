import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionsConfigPath } from "@muse-work/provider";

export type SessionStatus = "idle" | "running" | "error";
export type MusePermissionMode = "acceptEdits" | "bypassPermissions";

export function normalizePermissionMode(value: unknown): MusePermissionMode {
  return value === "bypassPermissions" ? "bypassPermissions" : "acceptEdits";
}

export interface Session {
  id: string;
  /**
   * SDK transcript id. Disk still accepts leftover `waveSessionId`;
   * new writes only persist `museSessionId`.
   */
  museSessionId?: string;
  title: string;
  workdir: string;
  permissionMode: MusePermissionMode;
  model: string;
  pinned: boolean;
  createdAt: number;
  lastActiveAt: number;
  /** Git worktree slug under `~/.muse-work/worktrees/<name>` when session is isolated. */
  worktreeName?: string;
  /** Branch created for the worktree (typically `worktree-<name>`). */
  worktreeBranch?: string;
  /** Base branch / ref used when creating the worktree. */
  baseBranch?: string;
  /** Main repo root; used to remove the worktree on session delete. */
  worktreeRepoRoot?: string;
  status: SessionStatus;
  /** Runtime-only: last process died mid-turn. Not written to disk. */
  interrupted?: boolean;
  /** 自定义 system prompt（缺省用默认 Muse prompt）。 */
  systemPrompt?: string;
  /** 会话选用的数字人 agent key（缺省由 session 场景映射解析；显式传/改后持久化）。 */
  agentName?: string;
  /** 会话级 fastModel（仅 agents.json 显式给或会话显式指定才覆盖默认）。 */
  fastModel?: string;
  /** agent 允许工具列表（展开后存会话；SDK AgentOptions.tools）。 */
  tools?: string[];
  /** agent 拒绝工具规则（展开后存会话；SDK AgentOptions.disallowedTools）。 */
  disallowedTools?: string[];
  /** agent 豁免工具规则（展开后存会话；SDK AgentOptions.allowedTools）。 */
  allowedTools?: string[];
  /** 会话 model 是否由用户显式指定（POST body.model / PATCH model）。true 时切换 agent 保留该 model。 */
  modelExplicit?: boolean;
  /** 会话 systemPrompt 是否由用户显式指定（POST body.systemPrompt，完全接管）。true 时切换 agent 保留。 */
  systemPromptExplicit?: boolean;
  /** user = 日常会话树；automation = 隐藏的无人值守运行。缺省 user。 */
  origin?: "user" | "automation";
}

export type SessionsFile = {
  version: 1;
  activeSessionId?: string;
  sessions: Array<
    Omit<Session, "interrupted"> & {
      status?: SessionStatus;
      /** leftover key from Wave-era sessions.json */
      waveSessionId?: string;
    }
  >;
};

export interface SessionStore {
  create(options: {
    workdir: string;
    model: string;
    permissionMode?: MusePermissionMode;
    worktreeName?: string;
    worktreeBranch?: string;
    baseBranch?: string;
    worktreeRepoRoot?: string;
    title?: string;
    systemPrompt?: string;
    agentName?: string;
    fastModel?: string;
    tools?: string[];
    disallowedTools?: string[];
    allowedTools?: string[];
    modelExplicit?: boolean;
    systemPromptExplicit?: boolean;
    origin?: "user" | "automation";
  }): Session;
  get(id: string): Session | undefined;
  list(): Session[];
  listGrouped(): {
    pinned: Session[];
    recent: Session[];
    activeSessionId?: string;
  };
  update(
    id: string,
    patch: Partial<Omit<Session, "id" | "status">>,
  ): Session | undefined;
  select(id: string): void;
  setMuseSessionId(id: string, museSessionId: string): Session | undefined;
  setUnreadDone(id: string, unreadDone: boolean): Session | undefined;
  updateStatus(id: string, status: SessionStatus): Session | undefined;
  delete(id: string): Session | undefined;
  getActiveSessionId(): string | undefined;
}

export interface CreateSessionStoreOptions {
  home?: string;
}

function defaultSessionsFile(): SessionsFile {
  return { version: 1, sessions: [] };
}

function loadSessionsFile(home: string): SessionsFile {
  const configPath = getSessionsConfigPath(home);
  if (!fs.existsSync(configPath)) {
    return defaultSessionsFile();
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as SessionsFile;
}

function saveSessionsFile(file: SessionsFile, home: string): void {
  const configPath = getSessionsConfigPath(home);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, configPath);
}

function toPersistedSession(
  session: Session,
): Omit<Session, "interrupted"> {
  const { interrupted: _interrupted, ...rest } = session;
  const { waveSessionId: _legacy, ...clean } = rest as typeof rest & {
    waveSessionId?: string;
  };
  return clean;
}

/** Listed only after the user has actually started chatting. */
export function isStartedSession(session: Session): boolean {
  return (
    Boolean(session.museSessionId) ||
    session.title !== "新对话" ||
    session.lastActiveAt > session.createdAt
  );
}

export function createSessionStore(
  options: CreateSessionStoreOptions = {},
): SessionStore {
  const home = options.home ?? process.env.MUSE_HOME ?? os.homedir();
  const file = loadSessionsFile(home);
  const sessions = new Map<string, Session>();
  const unreadDone = new Map<string, boolean>();
  let activeSessionId = file.activeSessionId;

  function persist(): void {
    saveSessionsFile(
      {
        version: 1,
        activeSessionId,
        sessions: [...sessions.values()].map(toPersistedSession),
      },
      home,
    );
  }

  let recoveredRunning = false;
  let migratedLegacyId = false;
  for (const record of file.sessions) {
    const wasRunning = record.status === "running";
    if (wasRunning) recoveredRunning = true;
    const { waveSessionId: legacyId, ...rest } = record;
    const museSessionId = rest.museSessionId ?? legacyId;
    if (legacyId && !rest.museSessionId) migratedLegacyId = true;
    sessions.set(rest.id, {
      ...rest,
      museSessionId,
      permissionMode: normalizePermissionMode(rest.permissionMode),
      status: "idle",
      ...(wasRunning ? { interrupted: true } : {}),
    });
  }
  if (recoveredRunning || migratedLegacyId) {
    persist();
  }

  function toSession(session: Session): Session {
    return { ...session };
  }

  return {
    create({
      workdir,
      model,
      permissionMode,
      worktreeName,
      worktreeBranch,
      baseBranch,
      worktreeRepoRoot,
      title,
      systemPrompt,
      agentName,
      fastModel,
      tools,
      disallowedTools,
      allowedTools,
      modelExplicit,
      systemPromptExplicit,
      origin,
    }): Session {
      const now = Date.now();
      const session: Session = {
        id: crypto.randomUUID(),
        title: title ?? "新对话",
        workdir,
        permissionMode: normalizePermissionMode(permissionMode),
        model,
        pinned: false,
        createdAt: now,
        lastActiveAt: now,
        status: "idle",
        origin: origin === "automation" ? "automation" : "user",
        ...(worktreeName ? { worktreeName } : {}),
        ...(worktreeBranch ? { worktreeBranch } : {}),
        ...(baseBranch ? { baseBranch } : {}),
        ...(worktreeRepoRoot ? { worktreeRepoRoot } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(agentName ? { agentName } : {}),
        ...(fastModel ? { fastModel } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(disallowedTools && disallowedTools.length > 0 ? { disallowedTools } : {}),
        ...(allowedTools && allowedTools.length > 0 ? { allowedTools } : {}),
        ...(modelExplicit ? { modelExplicit } : {}),
        ...(systemPromptExplicit ? { systemPromptExplicit } : {}),
      };
      sessions.set(session.id, session);
      persist();
      return toSession(session);
    },

    get(id: string): Session | undefined {
      const session = sessions.get(id);
      return session ? toSession(session) : undefined;
    },

    list(): Session[] {
      return [...sessions.values()].map(toSession);
    },

    listGrouped(): {
      pinned: Session[];
      recent: Session[];
      activeSessionId?: string;
    } {
      // Hide never-started sessions (created but no user message yet).
      // Keep them in the store so create→first-send is not deleted mid-flight.
      const all = this.list().filter(
        (s) => isStartedSession(s) && s.origin !== "automation",
      );
      const pinned = all
        .filter((s) => s.pinned)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      const recent = all
        .filter((s) => !s.pinned)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, 50);
      const activeListed =
        activeSessionId && all.some((s) => s.id === activeSessionId)
          ? activeSessionId
          : undefined;
      return { pinned, recent, activeSessionId: activeListed };
    },

    update(
      id: string,
      patch: Partial<Omit<Session, "id" | "status">>,
    ): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      Object.assign(session, patch);
      persist();
      return toSession(session);
    },

    select(id: string): void {
      if (!sessions.has(id)) {
        return;
      }
      activeSessionId = id;
      unreadDone.delete(id);
      persist();
    },

    setMuseSessionId(
      id: string,
      museSessionId: string,
    ): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      session.museSessionId = museSessionId;
      persist();
      return toSession(session);
    },

    setUnreadDone(id: string, value: boolean): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      if (value) {
        unreadDone.set(id, true);
      } else {
        unreadDone.delete(id);
      }
      return toSession(session);
    },

    updateStatus(id: string, status: SessionStatus): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      session.status = status;
      persist();
      return toSession(session);
    },

    delete(id: string): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      sessions.delete(id);
      unreadDone.delete(id);
      if (activeSessionId === id) {
        activeSessionId = undefined;
      }
      persist();
      return toSession(session);
    },

    getActiveSessionId(): string | undefined {
      return activeSessionId;
    },
  };
}
