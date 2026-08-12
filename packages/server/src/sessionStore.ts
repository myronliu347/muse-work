export type SessionStatus = "idle" | "running" | "error";

export interface Session {
  id: string;
  workdir: string;
  createdAt: number;
  status: SessionStatus;
}

export interface SessionStore {
  create(workdir: string): Session;
  get(id: string): Session | undefined;
  list(): Session[];
  updateStatus(id: string, status: SessionStatus): Session | undefined;
  delete(id: string): Session | undefined;
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    create(workdir: string): Session {
      const session: Session = {
        id: crypto.randomUUID(),
        workdir,
        createdAt: Date.now(),
        status: "idle",
      };
      sessions.set(session.id, session);
      return { ...session };
    },

    get(id: string): Session | undefined {
      const session = sessions.get(id);
      return session ? { ...session } : undefined;
    },

    list(): Session[] {
      return [...sessions.values()].map((s) => ({ ...s }));
    },

    updateStatus(id: string, status: SessionStatus): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      session.status = status;
      return { ...session };
    },

    delete(id: string): Session | undefined {
      const session = sessions.get(id);
      if (!session) {
        return undefined;
      }
      sessions.delete(id);
      return { ...session };
    },
  };
}
