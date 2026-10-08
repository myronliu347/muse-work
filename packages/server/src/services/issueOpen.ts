import { DEFAULT_ACTIVE_MODEL_ID } from "@muse-work/provider";
import type { Issue, IssueAgentMode, IssueStore } from "./issueStore.js";
import type { SessionStore } from "./sessionStore.js";
import {
  buildSystemPrompt,
  resolveAgentForScenario,
  resolvePermission,
} from "./agentConfig.js";
import { buildIssuePlanningExtra, buildIssueSingleAgentExtra } from "./issuePlanning.js";
import { getLogger } from "../utils/logger.js";

export type OpenIssueBody = {
  workdir?: string;
  worktreeEnabled?: boolean;
  baseBranch?: string;
  worktreeName?: string;
  worktreeBranch?: string;
  worktreeRepoRoot?: string;
  agentMode?: IssueAgentMode;
};

type OpenCtx = {
  home: string;
  issueStore: IssueStore;
  store: SessionStore;
  hub: { broadcastAll: (event: { type: "issue:changed" }) => void };
};

function isTerminal(status: Issue["status"]): boolean {
  return status === "completed" || status === "cancelled";
}

export function openIssueSession(
  ctx: OpenCtx,
  id: string,
  body: OpenIssueBody,
): { status: number; json: Record<string, unknown> } {
  const existing = ctx.issueStore.get(id);
  if (!existing) return { status: 404, json: { error: "not found" } };
  if (isTerminal(existing.status)) {
    return { status: 409, json: { error: "issue is terminal" } };
  }
  if (existing.planningSessionId) {
    return {
      status: 200,
      json: { sessionId: existing.planningSessionId, workdir: existing.workdir },
    };
  }
  const workdir = typeof body.workdir === "string" ? body.workdir.trim() : "";
  if (!workdir) return { status: 400, json: { error: "workdir required" } };
  const worktreeEnabled = Boolean(body.worktreeEnabled);
  const agentMode: IssueAgentMode = body.agentMode === "single" ? "single" : "split";
  const scenario = agentMode === "single" ? "session" : "issue-plan";
  const agent = resolveAgentForScenario(scenario, ctx.home);
  const permission = resolvePermission(agent.permission);
  const model = agent.model ?? DEFAULT_ACTIVE_MODEL_ID;
  if (!model) return { status: 400, json: { error: "no active model selected" } };
  const extra =
    agentMode === "single"
      ? buildIssueSingleAgentExtra(existing)
      : buildIssuePlanningExtra(existing);
  const session = ctx.store.create({
    workdir,
    model,
    title: existing.title,
    worktreeName: typeof body.worktreeName === "string" ? body.worktreeName : undefined,
    worktreeBranch: typeof body.worktreeBranch === "string" ? body.worktreeBranch : undefined,
    baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : undefined,
    worktreeRepoRoot:
      typeof body.worktreeRepoRoot === "string" ? body.worktreeRepoRoot : undefined,
    agentName: agent.key,
    systemPrompt: buildSystemPrompt(agent, extra),
    fastModel: agent.fastModel,
    tools: agent.tools,
    disallowedTools:
      permission.disallowedTools.length > 0 ? permission.disallowedTools : undefined,
    allowedTools: permission.allowedTools.length > 0 ? permission.allowedTools : undefined,
  });
  getLogger().info("issue planning session created", {
    issueId: id,
    sessionId: session.id,
    workdir: session.workdir,
    agentName: session.agentName,
  });
  const updated = ctx.issueStore.setPlanning(id, {
    planningSessionId: session.id,
    workdir,
    worktreeEnabled,
    baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : undefined,
    agentMode,
  });
  if (!updated) return { status: 409, json: { error: "conflict" } };
  ctx.hub.broadcastAll({ type: "issue:changed" });
  return { status: 200, json: { sessionId: session.id, workdir } };
}
