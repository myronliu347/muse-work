import { EMPTY_TURN_ERROR } from "../../constants/agent.js";
import { closeAgentLogger, getLogger } from "../../utils/logger.js";
import { mapSdkMessages } from "../../utils/messageMapper.js";
import { enrichFileHistory } from "../../utils/fileHistoryDiff.js";
import type { CoreLayer, RunnerContext } from "./ctx.js";

/**
 * Lifecycle cross-cutting functions (stall timers, interrupt, LRU destroy,
 * turn-end bookkeeping). Mutual callers live here so core never imports
 * agent/actions; upper layers reach them via ctx.core.
 */
export function createCore(ctx: RunnerContext): CoreLayer {
  const {
    store,
    hub,
    agents,
    agentLastUsed,
    agentIdentities,
    agentLoading,
    aborting,
    disposed,
    stallTimers,
    loadingSeen,
    titleGenerating,
    latestTokens,
    latestTasks,
    latestBackgroundTasks,
    latestWorkflowRuns,
    latestMcp,
    turnEnded,
    turnHadOutput,
    pending,
  } = ctx;

  function clearStallTimer(sessionId: string): void {
    const timer = stallTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      stallTimers.delete(sessionId);
    }
  }

  function bumpActivity(sessionId: string): void {
    touchAgent(sessionId);
    clearStallTimer(sessionId);
    if (!ctx.stallMs || ctx.stallMs <= 0) return;
    if (disposed.has(sessionId) || store.get(sessionId)?.status !== "running") {
      return;
    }
    if (hasPendingPermission(sessionId)) return;
    const timer = setTimeout(() => {
      stallTimers.delete(sessionId);
      if (disposed.has(sessionId) || store.get(sessionId)?.status !== "running") {
        return;
      }
      if (hasPendingPermission(sessionId)) return;
      interruptTurn(sessionId, {
        error: `Turn stalled after ${ctx.stallMs}ms with no activity`,
      });
    }, ctx.stallMs);
    stallTimers.set(sessionId, timer);
  }

  function markTurnOutput(sessionId: string): void {
    turnHadOutput.set(sessionId, true);
  }

  /** Push the full SDK transcript, enriched with file_history diff stats. */
  function broadcastMessages(sessionId: string): void {
    const session = store.get(sessionId);
    const messages = agents.get(sessionId)?.getMessages?.();
    if (!messages || !session) return;
    const mapped = mapSdkMessages(messages);
    hub.broadcast(sessionId, {
      type: "messages:replace",
      messages: enrichFileHistory(mapped, session.workdir, sessionId),
    });
  }

  /**
   * Push only the newest turn's file_history blocks (messageId + enriched
   * snapshots), not the full transcript — the webview merges these into the
   * matching messages so the file-change card appears when a turn ends. A turn
   * without file_history broadcasts nothing.
   */
  function broadcastFileHistory(sessionId: string): void {
    const session = store.get(sessionId);
    const messages = agents.get(sessionId)?.getMessages?.();
    if (!messages || !session) return;
    const enriched = enrichFileHistory(
      mapSdkMessages(messages),
      session.workdir,
      sessionId,
    );
    const updates: Array<{ messageId: string; snapshots: unknown[] }> = [];
    let inTurn = false;
    for (let i = enriched.length - 1; i >= 0; i--) {
      const m = enriched[i] as {
        role?: string;
        isMeta?: boolean;
        id?: string;
        blocks?: Array<Record<string, unknown>>;
      };
      if (m?.role === "user" && !m.isMeta) break;
      if (m?.role !== "assistant" || !m.id) continue;
      inTurn = true;
      const snapshots = (m.blocks ?? [])
        .filter((b) => b.type === "file_history")
        .flatMap((b) => (Array.isArray(b.snapshots) ? b.snapshots : []));
      if (snapshots.length > 0) {
        updates.push({ messageId: m.id, snapshots });
      }
    }
    if (!inTurn || updates.length === 0) return;
    hub.broadcast(sessionId, { type: "file_history:update", messages: updates });
  }

  function reportEmptyTurnIfNeeded(sessionId: string): void {
    if (disposed.has(sessionId) || aborting.has(sessionId)) {
      return;
    }
    if (turnEnded.get(sessionId) || turnHadOutput.get(sessionId)) {
      return;
    }
    turnHadOutput.set(sessionId, true);
    getLogger().warn("empty turn", { sessionId });
    hub.broadcast(sessionId, {
      type: "error:block",
      error: EMPTY_TURN_ERROR,
    });
  }

  function interruptTurn(
    sessionId: string,
    opts: { error?: string; denyMessage?: string } = {},
  ): void {
    aborting.add(sessionId);
    try {
      denyPendingPermissions(
        sessionId,
        opts.denyMessage ?? opts.error ?? "Aborted",
      );
      clearStallTimer(sessionId);
      agents.get(sessionId)?.abortMessage?.();
      agentLoading.set(sessionId, false);
      hub.broadcast(sessionId, { type: "loading", loading: false });
      // 中断（abort/stall/权限拒绝）时清空 sender 任务列表：任务进度只在
      // 会话执行中展示。不删除 latestTasks 缓存，后续轮次仍可复用。
      hub.broadcast(sessionId, { type: "tasks:update", tasks: [] });
      if (!turnEnded.get(sessionId)) {
        hub.broadcast(sessionId, { type: "message:completed" });
        turnEnded.set(sessionId, true);
      }
      if (opts.error) {
        finishTurnError(sessionId, new Error(opts.error));
      } else {
        markIdle(sessionId);
      }
    } finally {
      aborting.delete(sessionId);
    }
  }

  function hasPendingPermission(sessionId: string): boolean {
    for (const entry of pending.values()) {
      if (entry.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  function canIdleDestroy(sessionId: string): boolean {
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return false;
    }
    const session = store.get(sessionId);
    if (session?.status === "running") {
      return false;
    }
    if (hasPendingPermission(sessionId)) {
      return false;
    }
    // Queued messages live in the SDK's own queue now; keep the runtime alive
    // until they are dispatched so they are not lost on destroy.
    if (agents.get(sessionId)?.hasPendingMessages?.()) {
      return false;
    }
    // Background tasks / live subagents keep the runtime; destroying it kills them.
    if (agents.get(sessionId)?.hasRunningBackgroundWork?.()) {
      return false;
    }
    return true;
  }

  /** Destroy runtime only — keep sessions.json / museSessionId. */
  async function destroyRuntime(sessionId: string): Promise<void> {
    // Re-check immediately before dispose (TOCTOU vs runTurn / ensureAgent).
    if (!canIdleDestroy(sessionId)) {
      return;
    }
    clearStallTimer(sessionId);
    turnEnded.delete(sessionId);
    turnHadOutput.delete(sessionId);
    aborting.delete(sessionId);
    agentLoading.delete(sessionId);
    loadingSeen.delete(sessionId);
    titleGenerating.delete(sessionId);
    // UI caches: latestTasks is only read while a session is running (getTasks
    // returns [] when idle) and the rest are lazily rebuilt from the SDK on the
    // next ensureAgent. agentToolBinds & friends are kept so history view can
    // still resolve subagent transcripts from disk (cleared on disposeSession).
    latestTokens.delete(sessionId);
    latestTasks.delete(sessionId);
    latestBackgroundTasks.delete(sessionId);
    latestWorkflowRuns.delete(sessionId);
    latestMcp.delete(sessionId);
    closeAgentLogger(sessionId);
    const agent = agents.get(sessionId);
    agents.delete(sessionId);
    agentLastUsed.delete(sessionId);
    agentIdentities.delete(sessionId);
    if (agent) {
      await agent.dispose();
    }
  }

  function markUnreadDoneIfInactive(sessionId: string): void {
    if (store.getActiveSessionId() === sessionId) {
      return;
    }
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    store.setUnreadDone(sessionId, true);
    hub.broadcast(sessionId, {
      type: "session:unread",
      sessionId,
      unreadDone: true,
    });
  }

  function markIdle(sessionId: string): void {
    clearStallTimer(sessionId);
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    const wasRunning = store.get(sessionId)?.status === "running";
    if (wasRunning) {
      store.updateStatus(sessionId, "idle");
      hub.broadcast(sessionId, { type: "session:status", status: "idle" });
      // Only a finished turn is unread — idle loading=false (LRU dispose,
      // ensureAgent, SDK flicker) must not light the sidebar dot.
      markUnreadDoneIfInactive(sessionId);
      // interruptTurn(abort) calls markIdle directly while aborting is set;
      // SDK-driven loading=false settles are genuine turn ends.
      ctx.onTurnSettled?.(
        sessionId,
        aborting.has(sessionId)
          ? { ok: false, error: "interrupted" }
          : { ok: true },
      );
    }
  }

  function finishTurnError(sessionId: string, err: unknown): void {
    if (disposed.has(sessionId) || !store.get(sessionId)) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    getLogger().error("turn failed", { sessionId, error: message });
    store.updateStatus(sessionId, "error");
    hub.broadcast(sessionId, {
      type: "session:status",
      status: "error",
      error: message,
    });
    // Idle lets the SDK's own queue dispatch the next message via tryDispatch.
    store.updateStatus(sessionId, "idle");
    hub.broadcast(sessionId, { type: "session:status", status: "idle" });
    markUnreadDoneIfInactive(sessionId);
    ctx.onTurnSettled?.(sessionId, { ok: false, error: message });
  }

  function denyPendingPermissions(sessionId: string, message: string): void {
    for (const [id, entry] of pending) {
      if (entry.sessionId !== sessionId) continue;
      pending.delete(id);
      entry.resolve({ behavior: "deny", message });
    }
  }

  function touchAgent(sessionId: string): void {
    if (agents.has(sessionId)) {
      agentLastUsed.set(sessionId, Date.now());
    }
  }

  function overLiveCap(): boolean {
    if (ctx.maxLiveAgents > 0 && agents.size > ctx.maxLiveAgents) {
      return true;
    }
    if (ctx.heapEvictBytes > 0 && ctx.memoryUsage().heapUsed > ctx.heapEvictBytes) {
      return true;
    }
    return false;
  }

  function pickLruIdleVictim(keepSessionId: string): string | undefined {
    let oldestId: string | undefined;
    let oldestAt = Infinity;
    for (const id of agents.keys()) {
      if (id === keepSessionId) continue;
      if (!canIdleDestroy(id)) continue;
      const used = agentLastUsed.get(id) ?? 0;
      if (used < oldestAt) {
        oldestAt = used;
        oldestId = id;
      }
    }
    return oldestId;
  }

  /** Drop LRU idle runtimes until count/heap are within caps (never the keep session). */
  async function maybeEvictLiveAgents(keepSessionId: string): Promise<void> {
    while (overLiveCap()) {
      const victim = pickLruIdleVictim(keepSessionId);
      if (!victim) break;
      getLogger().info("evict live agent", {
        sessionId: victim,
        keepSessionId,
        agents: agents.size,
        heapUsed: ctx.memoryUsage().heapUsed,
      });
      await destroyRuntime(victim);
    }
  }

  return {
    clearStallTimer,
    bumpActivity,
    markTurnOutput,
    broadcastMessages,
    broadcastFileHistory,
    reportEmptyTurnIfNeeded,
    interruptTurn,
    hasPendingPermission,
    canIdleDestroy,
    destroyRuntime,
    markUnreadDoneIfInactive,
    markIdle,
    finishTurnError,
    denyPendingPermissions,
    touchAgent,
    maybeEvictLiveAgents,
  };
}
