import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionsConfigPath } from "@muse-work/provider";

export type SessionStatus = "idle" | "running" | "error";

export interface Session {
  id: string;
  waveSessionId?: string;
  title: string;
  workdir: string;
  permissionMode: "acceptEdits";
  model: string;
  pinned: boolean;
  createdAt: number;
  lastActiveAt: number;
  /** Git worktree slug under `.wave/worktrees/<name>` when session is isolated. */
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
}

export type SessionsFile = {
  version: 1;
  activeSessionId?: string;
  sessions: Array<Omit<Session, "interrupted"> & { status?: SessionStatus }>;
};

export interface SessionStore {
  create(options: {
    workdir: string;
    model: string;
    worktreeName?: string;
    worktreeBranch?: string;
    baseBranch?: string;
    worktreeRepoRoot?: string;
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
  setWaveSessionId(id: string, waveSessionId: string): Session | undefined;
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
  return rest;
}

/** Listed only after the user has actually started chatting. */
export function isStartedSession(session: Session): boolean {
  return (
    Boolean(session.waveSessionId) ||
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
  for (const record of file.sessions) {
    const wasRunning = record.status === "running";
    if (wasRunning) recoveredRunning = true;
    sessions.set(record.id, {
      ...record,
      status: "idle",
      ...(wasRunning ? { interrupted: true } : {}),
    });
  }
  if (recoveredRunning) {
    persist();
  }

  function toSession(session: Session): Session {
    return { ...session };
  }

  return {
    create({
      workdir,
      model,
      worktreeName,
      worktreeBranch,
      baseBranch,
      worktreeRepoRoot,
    }): Session {
      const now = Date.now();
      const session: Session = {
        id: crypto.randomUUID(),
        title: "新对话",
        workdir,
        permissionMode: "acceptEdits",
        model,
        pinned: false,
        createdAt: now,
        lastActiveAt: now,
        status: "idle",
        ...(worktreeName ? { worktreeName } : {}),
        ...(worktreeBranch ? { worktreeBranch } : {}),
        ...(baseBranch ? { baseBranch } : {}),
        ...(worktreeRepoRoot ? { worktreeRepoRoot } : {}),
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
      const all = this.list().filter(isStartedSession);
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

    setWaveSessionId(
      id: string,
      waveSessionId: string,
    ): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      session.waveSessionId = waveSessionId;
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
