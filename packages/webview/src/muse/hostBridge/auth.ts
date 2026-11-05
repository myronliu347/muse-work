import { DEFAULT_TITLE, isAuthError, postToWebview, truncateTitle } from "./utils.js";
import type { BridgeCtx } from "./ctx.js";

export interface AuthModule {
  refreshAuth: () => Promise<void>;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  promptCodeMakerReauth: () => void;
  maybePromptAuthDialog: (error: string) => void;
  maybePatchTitle: (sid: string, text: string) => void;
  normalizeOutboundImages: (raw: unknown) => Array<{ data: string; mediaType: string }>;
}

export function normalizeOutboundImages(
  raw: unknown,
): Array<{ data: string; mediaType: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ data: string; mediaType: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const data = (item as { data?: unknown }).data;
    const mediaType = (item as { mediaType?: unknown }).mediaType;
    if (typeof data !== "string" || !data) continue;
    out.push({
      data,
      mediaType:
        typeof mediaType === "string" && mediaType
          ? mediaType
          : "image/png",
    });
  }
  return out;
}

export function createAuthModule(ctx: BridgeCtx): AuthModule {
  async function refreshAuth(): Promise<void> {
    try {
      const status = await ctx.api.getAuthStatus();
      ctx.activeProviderId = status.providerId;
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: status.state === "authenticated",
      });
    } catch {
      postToWebview({
        command: "authStatusResponse",
        isAuthenticated: false,
      });
    }
  }

  /** Prompt re-login when a turn fails on auth grounds for an SSO provider. */
  function promptCodeMakerReauth(): void {
    const providerId = ctx.activeProviderId;
    if (providerId && providerId !== "codemaker" && providerId !== "codex") {
      return;
    }
    postToWebview({
      command: "showAuthDialog",
      providerId: providerId ?? "codemaker",
    });
  }

  function maybePromptAuthDialog(error: string): void {
    if (/未配置密钥/.test(error)) {
      postToWebview({ command: "showAuthDialog", providerId: "deepseek" });
      return;
    }
    if (!isAuthError(error)) return;
    // Local getAuthStatus can still be authenticated (expire timestamp not
    // hit yet). Flip UI auth so LoginDialog is not auto-closed on mount.
    postToWebview({
      command: "authStatusResponse",
      isAuthenticated: false,
    });
    promptCodeMakerReauth();
  }

  async function handleLogin(): Promise<void> {
    try {
      const start = await ctx.api.login();
      if (start && typeof start === "object" && "authUrl" in start && start.authUrl) {
        ctx.openExternal(start.authUrl);
        await ctx.api.login({ wait: true });
      }
      await refreshAuth();
      postToWebview({ command: "loginResponse", success: true });
    } catch (err) {
      postToWebview({
        command: "loginResponse",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleLogout(): Promise<void> {
    try {
      await ctx.api.logout();
      postToWebview({ command: "logoutResponse", success: true });
      postToWebview({ command: "authStatusResponse", isAuthenticated: false });
    } catch (err) {
      postToWebview({
        command: "logoutResponse",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function maybePatchTitle(sid: string, text: string): void {
    if (ctx.titledSessions.has(sid)) return;
    const existing = ctx.treeById().get(sid);
    if (existing && existing.title && existing.title !== DEFAULT_TITLE) {
      ctx.titledSessions.add(sid);
      return;
    }
    // Local placeholder only — the server owns the persisted title and replaces
    // it with an AI summary (session:titled) when generation completes.
    const title = truncateTitle(text);
    ctx.titledSessions.add(sid);
    ctx.patchTreeSession(sid, { title });
    if (ctx.sessionId === sid) {
      const cur = ctx.treeById().get(sid);
      if (cur) ctx.emitCurrentSession(cur);
    }
  }

  return {
    refreshAuth,
    handleLogin,
    handleLogout,
    promptCodeMakerReauth,
    maybePromptAuthDialog,
    maybePatchTitle,
    normalizeOutboundImages,
  };
}
