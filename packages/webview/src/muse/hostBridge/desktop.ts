import { newId, postToWebview, showServerToast } from "./utils.js";
import type { BridgeCtx, WorkdirStatePatch } from "./ctx.js";

export type DesktopCreateWorktreeMsg = {
  workdir?: string;
  baseBranch?: string;
  name?: string;
  text?: string;
  images?: unknown;
  /** When set, hostBridge forwards to Electron without minting a session. */
  requestId?: string;
};

export interface DesktopModule {
  rememberRecentWorkdir: (path: string) => void;
  emitWorkdirState: (patch?: WorkdirStatePatch) => void;
  handleDesktopCreateWorktree: (msg: DesktopCreateWorktreeMsg) => Promise<void>;
}

export function createDesktopModule(ctx: BridgeCtx): DesktopModule {
  /** Skip auto-minted `~/.muse-work` / `~/.dev-muse-work` scratch dirs and `.wave/worktrees/…`. */
  const isTransientWorkdir = (dir: string): boolean => {
    const segments = dir.split(/[\\/]/).filter(Boolean);
    return segments.some(
      (seg, i) =>
        seg === ".muse-work" ||
        seg === ".dev-muse-work" ||
        (seg === ".wave" && segments[i + 1] === "worktrees"),
    );
  };
  /** Adds a workdir to the recents list; transient dirs never enter it. */
  const rememberRecentWorkdir = (path: string): void => {
    if (isTransientWorkdir(path)) return;
    ctx.recentWorkdirs = [
      path,
      ...ctx.recentWorkdirs.filter((p) => p !== path),
    ].slice(0, 10);
  };

  const syncChatWorkdir = (workdir: string | undefined) => {
    postToWebview({ command: "updateWorkdir", workdir });
  };

  const emitWorkdirState = (patch?: WorkdirStatePatch) => {
    if (patch?.clearWorkdir) {
      ctx.currentWorkdir = "";
      if (patch.clearSession) ctx.sessionId = null;
    } else if (typeof patch?.workdir === "string" && patch.workdir) {
      ctx.currentWorkdir = patch.workdir;
      if (patch.clearSession) ctx.sessionId = null;
    }
    if (patch?.recentWorkdirs) {
      ctx.recentWorkdirs = patch.recentWorkdirs;
    }
    const workdir = ctx.currentWorkdir || undefined;
    postToWebview({
      command: "desktopWorkdirState",
      workdir,
      recentWorkdirs: ctx.recentWorkdirs,
      host: "local",
    });
    syncChatWorkdir(workdir);
  };

  // Keep createSession workdir in sync when Electron main (or tests) push state.
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as {
      command?: string;
      workdir?: string;
      recentWorkdirs?: string[];
      requestId?: string;
      name?: string;
      path?: string;
      branch?: string;
      baseBranch?: string;
      repoRoot?: string;
      error?: string;
    };
    if (message?.command === "desktopWorktreeCreated") {
      const reqId =
        typeof message.requestId === "string" ? message.requestId : "";
      const pending = reqId ? ctx.pendingWorktrees.get(reqId) : undefined;
      if (pending) {
        ctx.pendingWorktrees.delete(reqId);
        if (typeof message.error === "string" && message.error) {
          pending.resolve({ ok: false, error: message.error });
        } else if (
          typeof message.name === "string" &&
          typeof message.path === "string" &&
          typeof message.branch === "string" &&
          typeof message.repoRoot === "string"
        ) {
          pending.resolve({
            ok: true,
            name: message.name,
            path: message.path,
            branch: message.branch,
            baseBranch:
              typeof message.baseBranch === "string"
                ? message.baseBranch
                : "HEAD",
            repoRoot: message.repoRoot,
          });
        } else {
          pending.resolve({ ok: false, error: "创建 worktree 返回不完整" });
        }
      }
      return;
    }
    if (message?.command === "desktopPrepareQuit") {
      void (async () => {
        const ids = new Set<string>();
        if (ctx.sessionId && !ctx.pendingNewSession) ids.add(ctx.sessionId);
        for (const s of [...ctx.pinned, ...ctx.recent]) {
          if (s.running) ids.add(s.id);
        }
        await ctx.handleAbortMessage();
        for (const id of ids) {
          if (id === ctx.sessionId) continue;
          try {
            await ctx.api.abortMessage(id);
          } catch {
            // best-effort
          }
        }
        ctx.setLoading(false);
        ctx.publishAgentBusy();
        ctx.outer?.postMessage({ command: "desktopPrepareQuitDone" });
      })();
      return;
    }
    if (message?.command === "museServerLifecycle") {
      const state = (message as { state?: string }).state;
      if (state === "restarting") {
        showServerToast("本地服务已退出，正在重新拉起…");
        return;
      }
      if (state === "ready") {
        showServerToast("本地服务已恢复");
        void (async () => {
          await (typeof ctx.ws.reconnectNow === "function"
            ? ctx.ws.reconnectNow()
            : ctx.ws.connect("*"));
          await ctx.resyncAfterReconnect();
        })();
        return;
      }
      if (state === "resume") {
        void (async () => {
          await (typeof ctx.ws.reconnectNow === "function"
            ? ctx.ws.reconnectNow()
            : ctx.ws.connect("*"));
          await ctx.resyncAfterReconnect();
        })();
        return;
      }
      if (state === "dead" || state === "failed") {
        showServerToast("本地服务无法恢复，请重启应用");
        ctx.resetChatStreaming();
      }
      return;
    }
    if (message?.command !== "desktopWorkdirState") return;
    if (Array.isArray(message.recentWorkdirs)) {
      ctx.recentWorkdirs = message.recentWorkdirs.filter(
        (p) => typeof p === "string" && !isTransientWorkdir(p),
      );
    }
    if (ctx.suppressWorkdirPush) return;
    if (typeof message.workdir === "string" && message.workdir) {
      if (message.workdir !== ctx.currentWorkdir) {
        ctx.sessionId = null;
      }
      ctx.currentWorkdir = message.workdir;
      syncChatWorkdir(ctx.currentWorkdir);
    }
  });

  const handleDesktopCreateWorktree = async (
    msg: DesktopCreateWorktreeMsg,
  ): Promise<void> => {
    const workdir =
      (typeof msg.workdir === "string" && msg.workdir) || ctx.currentWorkdir;
    const text = (msg.text ?? "").trim();
    const images = ctx.normalizeOutboundImages(msg.images);
    if (!workdir) {
      postToWebview({
        command: "updateErrorBlock",
        error: "创建 worktree 失败：未选择仓库目录",
      });
      return;
    }
    if (!text && images.length === 0) return;

    const requestId = newId("wt");
    const created = await new Promise<
      | {
          ok: true;
          name: string;
          path: string;
          branch: string;
          baseBranch: string;
          repoRoot: string;
        }
      | { ok: false; error: string }
    >((resolve) => {
      ctx.pendingWorktrees.set(requestId, { text, images, resolve });
      ctx.outer?.postMessage({
        command: "desktopCreateWorktree",
        requestId,
        workdir,
        baseBranch: msg.baseBranch,
        name: msg.name,
        text,
        images,
      });
      // If Electron is unavailable (tests without outer), fail fast.
      if (!ctx.outer) {
        ctx.pendingWorktrees.delete(requestId);
        resolve({ ok: false, error: "桌面宿主不可用" });
      }
    });

    if (!created.ok) {
      postToWebview({
        command: "updateErrorBlock",
        error: `创建 worktree 失败：${created.error}`,
      });
      return;
    }

    // Switch createSession into the new worktree path.
    ctx.suppressWorkdirPush = false;
    ctx.currentWorkdir = created.path;
    syncChatWorkdir(created.path);
    ctx.pendingNewSession = true;
    ctx.sessionId = null;

    try {
      await ctx.ensureWs();
      const session = await ctx.api.createSession(created.path, {
        ...(ctx.draftModel ? { model: ctx.draftModel } : {}),
        permissionMode: ctx.draftPermissionMode,
        worktreeName: created.name,
        worktreeBranch: created.branch,
        baseBranch: created.baseBranch,
        worktreeRepoRoot: created.repoRoot,
      });
      await ctx.api.selectSession(session.id);
      ctx.sessionId = session.id;
      ctx.pendingNewSession = false;
      ctx.draftModel = undefined;
      ctx.draftPermissionMode = "acceptEdits";
      ctx.emitCurrentSession(session);
      await ctx.refreshTree();
      await ctx.handleSendMessage({ text, images });
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return { rememberRecentWorkdir, emitWorkdirState, handleDesktopCreateWorktree };
}
