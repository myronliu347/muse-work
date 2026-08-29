/** Default model for new / draft sessions. Keep in sync with provider DEFAULT_ACTIVE_MODEL_ID. */
export const DEFAULT_SESSION_MODEL_ID = "deepseek-v4-flash";

/** Minimal shape of an agent entry needed to resolve its model. */
export interface DraftAgentLike {
  key: string;
  model?: string;
}

/**
 * Resolve the model id shown in the composer's model selector for a *draft*
 * (new, first message not sent yet) session.
 *
 * - A user-manual model pick (stored in ctx.draftModel, surfaces as
 *   currentSession.model) must always win — keep currentModel unless it is
 *   still the untouched default.
 * - Otherwise resolve the draft session's bound agent — the explicitly
 *   selected draft agent (agentName), or the session scenario's default agent
 *   key (defaultAgentKey) — and use its model from the agents list.
 * - Fall back to the hard default when no agent model is available.
 */
export function resolveDraftModel(
  currentModel: string | undefined,
  agentName: string | undefined,
  defaultAgentKey: string,
  agents: DraftAgentLike[],
  fallback: string = DEFAULT_SESSION_MODEL_ID,
): string {
  if (currentModel && currentModel !== DEFAULT_SESSION_MODEL_ID) {
    return currentModel;
  }
  const key = agentName || defaultAgentKey;
  const agentModel = agents.find((a) => a.key === key)?.model;
  return agentModel || fallback;
}
