import type { WsBroadcastEvent } from "../wsHub.js";
import { closeAgentLogger } from "../../utils/logger.js";
import { mapSdkMessages } from "../../utils/messageMapper.js";
import { enrichFileHistory, revertSnapshots } from "../../utils/fileHistoryDiff.js";
import {
  isRewindTargetMessage,
  toSerializableSlashCommand,
  toSerializableWorkflowRuns,
  userMessageText,
} from "./serialization.js";
import type {
  OutboundImage,
  RunnerContext,
  SessionImage,
  SessionRunner,
} from "./ctx.js";

function toSdkImages(images?: OutboundImage[]): SessionImage[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((img) => ({
    path: img.data,
    mimeType: img.mediaType || "image/png",
  }));
}

/**
 * Public SessionRunner methods (HTTP/WS-facing actions). Depends only on
 * agent (via ctx.agent) + core (via ctx.core) + ctx + serialization.
 */
export function createActions(ctx: RunnerContext): SessionRunner {
  const {
    store,
    hub,
    agents,
    agentLastUsed,
    agentIdentities,
    pending,
    disposed,
    turnEnded,
    turnHadOutput,
    aborting,
    agentLoading,
    loadingSeen,
    agentToolBinds,
    pendingAgentToolIds,
    unboundSubagentIds,
    knownAgentToolIds,
    latestTasks,
    latestBackgroundTasks,
    latestWorkflowRuns,
    latestMcp,
    latestTokens,
    titleGenerating,
  } = ctx;
  const core = ctx.core;
  const agent = ctx.agent;

  return {
    setOnTurnSettled(cb: (sessionId: string, result: { ok: boolean; error?: string }) => void) {
      ctx.onTurnSettled = cb;
    },

    async sendMessage(sessionId, content, images, source) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }

      const sdkImages = toSdkImages(images);
      if (!content.trim() && !sdkImages?.length) {
        throw Object.assign(new Error("content or images is required"), {
          statusCode: 400,
        });
      }

      // Fire-and-forget so HTTP can return { accepted: true } promptly.
      // If a turn is already in flight, the SDK enqueues the message internally
      // and dispatches it once loading drops (its own serialized queue).
      void agent.runTurn(sessionId, content, sdkImages, source);

      return { accepted: true };
    },

    async askBtw(sessionId, question, abortSignal) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = await agent.ensureAgent(sessionId);
      if (!existing.askBtw) {
        throw new Error("askBtw unavailable for this session");
      }
      return existing.askBtw(question, abortSignal);
    },

    async abortMessage(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }

      core.interruptTurn(sessionId, { denyMessage: "Aborted by user" });

      return { ok: true };
    },

    async deleteQueuedMessageById(sessionId, messageId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = agents.get(sessionId);
      if (!existing?.removeQueuedMessageById) {
        return { ok: false };
      }
      const removed = existing.removeQueuedMessageById(messageId);
      return { ok: removed };
    },

    async updateQueuedMessage(sessionId, messageId, patch) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = agents.get(sessionId);
      if (!existing?.updateQueuedMessageById) {
        return { ok: false };
      }
      const sdkPatch: { content?: string; images?: SessionImage[] } = {};
      if (typeof patch.content === "string") {
        sdkPatch.content = patch.content;
      }
      const sdkImages = toSdkImages(patch.images);
      if (sdkImages) {
        sdkPatch.images = sdkImages;
      }
      const updated = existing.updateQueuedMessageById(messageId, sdkPatch);
      return { ok: updated };
    },

    async getRuntimeState(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = agents.get(sessionId);
      return {
        loading: existing?.isLoading?.() ?? agentLoading.get(sessionId) ?? false,
        queuedMessages: existing?.queuedMessages?.() ?? [],
      };
    },

    async respondPermission(sessionId, permissionId, decision) {
      const entry = pending.get(permissionId);
      if (!entry || entry.sessionId !== sessionId) {
        throw Object.assign(new Error(`permission not found: ${permissionId}`), {
          statusCode: 404,
        });
      }
      pending.delete(permissionId);
      const behavior =
        decision.behavior === "deny" || decision.behavior === "allow"
          ? decision.behavior
          : "deny";
      entry.resolve({
        behavior,
        message:
          decision.message ??
          (behavior === "deny" ? "Denied by user" : undefined),
        newPermissionMode: decision.newPermissionMode,
        newPermissionRule: decision.newPermissionRule,
      });
      return { ok: true };
    },

    async disposeSession(sessionId) {
      disposed.add(sessionId);
      core.clearStallTimer(sessionId);
      turnEnded.delete(sessionId);
      turnHadOutput.delete(sessionId);
      aborting.delete(sessionId);
      agentLoading.delete(sessionId);
      loadingSeen.delete(sessionId);
      titleGenerating.delete(sessionId);
      closeAgentLogger(sessionId);
      agentToolBinds.delete(sessionId);
      pendingAgentToolIds.delete(sessionId);
      unboundSubagentIds.delete(sessionId);
      knownAgentToolIds.delete(sessionId);
      latestTasks.delete(sessionId);
      latestBackgroundTasks.delete(sessionId);
      latestWorkflowRuns.delete(sessionId);
      latestMcp.delete(sessionId);
      latestTokens.delete(sessionId);
      for (const [id, entry] of pending) {
        if (entry.sessionId === sessionId) {
          pending.delete(id);
          entry.resolve({
            behavior: "deny",
            message: "Session disposed",
          });
        }
      }
      const existing = agents.get(sessionId);
      agents.delete(sessionId);
      agentLastUsed.delete(sessionId);
      agentIdentities.delete(sessionId);
      if (existing) {
        await existing.dispose();
      }
      store.delete(sessionId);
    },

    /** 释放会话的 live agent（不动会话记录/消息）。agent 变更（如 agentName）后调用，下次 ensureAgent 重建。 */
    async disposeAgent(sessionId) {
      const existing = agents.get(sessionId);
      agents.delete(sessionId);
      agentLastUsed.delete(sessionId);
      agentIdentities.delete(sessionId);
      core.clearStallTimer(sessionId);
      if (existing) {
        await existing.dispose();
      }
      return { ok: true as const };
    },

    async getMessages(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      // Serve history without forcing agent creation: use the live runtime when
      // one exists, otherwise read the persisted jsonl from disk.
      const existing = agents.get(sessionId);
      let sdkMessages: unknown[] = [];
      if (existing?.getMessages) {
        sdkMessages = existing.getMessages();
        core.touchAgent(sessionId);
      } else {
        // SDK persists sessions under its own id (museSessionId), not the
        // server store's session id — reading by sessionId would miss the file.
        const diskId = session.museSessionId ?? sessionId;
        const data = await agent.loadMainSessionFromDisk(
          diskId,
          session.workdir,
        );
        sdkMessages = data?.messages ?? [];
      }
      const nested = await agent.attachNestedMessages(
        sessionId,
        session.workdir,
        mapSdkMessages(sdkMessages),
      );
      // Attach per-file +N/−M diff stats to the last assistant message's
      // file_history block (UI card). Read-only enrichment; SDK blocks intact.
      return enrichFileHistory(nested, session.workdir, sessionId);
    },

    async compact(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      if (session.status === "running") {
        core.interruptTurn(sessionId, { denyMessage: "Aborted for compact" });
      }
      const existing = await agent.ensureAgent(sessionId);
      if (!existing.compact) {
        throw Object.assign(new Error("compact is not supported"), {
          statusCode: 501,
        });
      }
      try {
        await existing.compact();
        return { ok: true as const };
      } finally {
        hub.broadcast(sessionId, {
          type: "compaction:state",
          isCompacting: false,
        });
      }
    },

    async clear(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      if (session.status === "running") {
        throw Object.assign(new Error("session is running"), {
          statusCode: 409,
        });
      }
      const existing = await agent.ensureAgent(sessionId);
      if (!existing.clearMessages) {
        throw Object.assign(new Error("clear is not supported"), {
          statusCode: 501,
        });
      }
      await existing.clearMessages();
      hub.broadcast(sessionId, {
        type: "messages:replace",
        messages: [],
      });
      return { ok: true as const };
    },

    async listRewindCheckpoints(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = await agent.ensureAgent(sessionId);
      const messages = existing.getMessages?.() ?? [];
      return messages.flatMap((message) => {
        if (!isRewindTargetMessage(message)) return [];
        const id = (message as { id: string }).id;
        return [{ id, content: userMessageText(message) }];
      });
    },

    async rewind(sessionId, messageId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      if (session.status === "running") {
        core.interruptTurn(sessionId, { denyMessage: "Aborted for rewind" });
      }
      const existing = await agent.ensureAgent(sessionId);
      const messages = existing.getMessages?.() ?? [];
      const index = messages.findIndex(
        (message) =>
          isRewindTargetMessage(message) &&
          (message as { id: string }).id === messageId,
      );
      if (index < 0) {
        throw Object.assign(new Error(`checkpoint not found: ${messageId}`), {
          statusCode: 404,
        });
      }
      if (!existing.truncateHistory) {
        throw Object.assign(new Error("rewind is not supported"), {
          statusCode: 501,
        });
      }
      const inputContent = userMessageText(messages[index]);
      await existing.truncateHistory(index);
      core.broadcastMessages(sessionId);
      return { ok: true as const, inputContent };
    },

    async revertFileHistory(sessionId, messageIds: string[]) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = await agent.ensureAgent(sessionId);
      const messages = existing.getMessages?.() ?? [];
      const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
      const snapshots = ids.flatMap((messageId) => {
        const target = messages.find(
          (m) => (m as { id?: string }).id === messageId,
        );
        if (!target) return [];
        return (
          (target as { blocks?: Array<{ type?: string; snapshots?: unknown[] }> })
            .blocks ?? []
        )
          .filter((b) => b.type === "file_history")
          .flatMap((b) => b.snapshots ?? []);
      });
      if (snapshots.length === 0) {
        throw Object.assign(new Error("no file history to revert"), {
          statusCode: 404,
        });
      }
      const revertedCount = revertSnapshots(
        snapshots as Array<{
          filePath?: string;
          snapshotPath?: string;
          operation?: string;
          timestamp?: number;
        }>,
      );
      core.broadcastMessages(sessionId);
      return { ok: true as const, revertedCount };
    },

    async setPermissionMode(sessionId, mode) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const normalized =
        mode === "bypassPermissions" ? "bypassPermissions" : "acceptEdits";
      store.update(sessionId, { permissionMode: normalized });
      const existing = agents.get(sessionId);
      existing?.setPermissionMode?.(normalized);
      hub.broadcast(sessionId, {
        type: "permission-mode",
        mode: normalized,
      });
      return { ok: true as const, mode: normalized };
    },

    async getStatus(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = agents.get(sessionId);
      const latestTotalTokens =
        latestTokens.get(sessionId) ?? existing?.latestTotalTokens ?? 0;
      return {
        sessionId: session.id,
        workdir: session.workdir,
        permissionMode: session.permissionMode,
        latestTotalTokens,
        museSessionId: session.museSessionId,
      };
    },

    async getMcpServers(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const cached = latestMcp.get(sessionId);
      if (cached) return cached;
      const existing = agents.get(sessionId);
      if (existing?.getMcpServers) {
        const servers = existing.getMcpServers() ?? [];
        latestMcp.set(sessionId, servers);
        return servers;
      }
      try {
        const created = await agent.ensureAgent(sessionId);
        const servers = created.getMcpServers?.() ?? [];
        latestMcp.set(sessionId, servers);
        return servers;
      } catch {
        return [];
      }
    },

    async connectMcpServer(sessionId, name) {
      const existing = await agent.ensureAgent(sessionId);
      const ok = (await existing.connectMcpServer?.(name)) ?? false;
      const servers = existing.getMcpServers?.() ?? [];
      latestMcp.set(sessionId, servers);
      hub.broadcast(sessionId, { type: "mcp:update", servers });
      return { ok };
    },

    async disconnectMcpServer(sessionId, name) {
      const existing = await agent.ensureAgent(sessionId);
      const ok = (await existing.disconnectMcpServer?.(name)) ?? false;
      const servers = existing.getMcpServers?.() ?? [];
      latestMcp.set(sessionId, servers);
      hub.broadcast(sessionId, { type: "mcp:update", servers });
      return { ok };
    },

    async getBackgroundTaskOutput(sessionId, taskId) {
      const existing = await agent.ensureAgent(sessionId);
      return existing.getBackgroundTaskOutput?.(taskId) ?? null;
    },

    async getBackgroundTasks(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      return agent.reconcileBackgroundTasks(sessionId);
    },

    // 任务列表只在会话执行中展示：idle 会话返回空，避免切换回已结束的会话时
    // 展示历史遗留任务。活跃判断与 snapshotEvents 保持一致。
    async getTasks(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const loadingNow = agentLoading.get(sessionId) === true;
      const pendingReq = [...pending.values()].some(
        (entry) => entry.sessionId === sessionId,
      );
      if (session.status === "idle" && !loadingNow && !pendingReq) {
        return [];
      }
      return latestTasks.get(sessionId) ?? [];
    },

    async stopBackgroundTask(sessionId, taskId) {
      const existing = await agent.ensureAgent(sessionId);
      const ok = existing.stopBackgroundTask?.(taskId) ?? false;
      return { ok };
    },

    async getWorkflowRuns(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      const existing = agents.get(sessionId);
      if (existing?.getWorkflowRuns) {
        const raw = (await existing.getWorkflowRuns()) ?? [];
        const runs = toSerializableWorkflowRuns(raw);
        latestWorkflowRuns.set(sessionId, runs);
        return runs;
      }
      // No live runtime: serve the cached snapshot (empty after idle TTL
      // destroyed the agent) instead of forcing agent creation.
      return latestWorkflowRuns.get(sessionId) ?? [];
    },

    async stopWorkflowRun(sessionId, runId) {
      const existing = await agent.ensureAgent(sessionId);
      existing.stopWorkflowRun?.(runId);
      return { ok: true as const };
    },

    async getSlashCommands(sessionId) {
      const session = store.get(sessionId);
      if (!session) {
        throw Object.assign(new Error(`session not found: ${sessionId}`), {
          statusCode: 404,
        });
      }
      // 斜杠命令来自 agent 运行时（SDK 内置 /subtask + userInvocable 技能注册的
      // 命令），不返回硬编码系统指令；优先用现有 agent，避免仅为展示弹窗创建。
      const existing = agents.get(sessionId);
      if (existing?.getSlashCommands) {
        return existing.getSlashCommands().map(toSerializableSlashCommand);
      }
      try {
        const created = await agent.ensureAgent(sessionId);
        return (created.getSlashCommands?.() ?? []).map(
          toSerializableSlashCommand,
        );
      } catch {
        return [];
      }
    },

    invalidateAgentIdentities() {
      agentIdentities.clear();
    },

    snapshotEvents() {
      const events: WsBroadcastEvent[] = [];
      for (const session of store.list()) {
        if (disposed.has(session.id)) continue;
        const loadingNow = agentLoading.get(session.id) === true;
        const pendingReq = [...pending.values()].find(
          (entry) => entry.sessionId === session.id,
        );
        if (session.status === "idle" && !loadingNow && !pendingReq) {
          continue;
        }
        if (session.status !== "idle") {
          events.push({
            type: "session:status",
            status: session.status,
            sessionId: session.id,
          });
        }
        if (loadingNow) {
          events.push({
            type: "loading",
            loading: true,
            sessionId: session.id,
          });
        }
        if (pendingReq) {
          events.push({ ...pendingReq.request, sessionId: session.id });
        }
        const tasks = latestTasks.get(session.id);
        if (tasks && tasks.length > 0) {
          events.push({ type: "tasks:update", tasks, sessionId: session.id });
        }
        const background = latestBackgroundTasks.get(session.id);
        if (background && background.length > 0) {
          events.push({
            type: "background-tasks:update",
            tasks: background,
            sessionId: session.id,
          });
        }
        const runs = latestWorkflowRuns.get(session.id);
        if (runs && runs.length > 0) {
          events.push({
            type: "workflow-runs:update",
            runs,
            sessionId: session.id,
          });
        }
        const mcp = latestMcp.get(session.id);
        if (mcp && mcp.length > 0) {
          events.push({ type: "mcp:update", servers: mcp, sessionId: session.id });
        }
        const tokens = latestTokens.get(session.id);
        if (typeof tokens === "number") {
          events.push({
            type: "tokens:update",
            latestTotalTokens: tokens,
            sessionId: session.id,
          });
        }
        events.push({
          type: "permission-mode",
          mode: session.permissionMode,
          sessionId: session.id,
        });
      }
      return events;
    },

    async abortRunningTurns(reason) {
      let aborted = 0;
      for (const session of store.list()) {
        if (session.status !== "running") continue;
        if (core.hasPendingPermission(session.id)) continue;
        core.interruptTurn(session.id, { error: reason });
        aborted += 1;
      }
      return { aborted };
    },

    async shutdown() {
      let aborted = 0;
      for (const session of store.list()) {
        if (session.status !== "running") continue;
        core.interruptTurn(session.id, {
          error: "Server shutting down",
          denyMessage: "Server shutting down",
        });
        aborted += 1;
      }
      return { aborted };
    },

    getAgentCount() {
      return agents.size;
    },
  };
}
