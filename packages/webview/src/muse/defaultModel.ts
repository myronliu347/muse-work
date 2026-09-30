/** Default model for new / draft sessions. Keep in sync with provider DEFAULT_ACTIVE_MODEL_ID. */
export const DEFAULT_SESSION_MODEL_ID = "deepseek-flash";

/**
 * Resolve the model id shown in the composer's model selector for a *draft*
 * session.
 *
 * - A user-manual model pick must always win unless it is still the untouched default.
 * - Otherwise use the「普通会话」场景默认 model from server config.
 */
export function resolveDraftModel(
  currentModel: string | undefined,
  sessionScenarioModel: string | undefined,
  fallback: string = DEFAULT_SESSION_MODEL_ID,
): string {
  if (currentModel && currentModel !== DEFAULT_SESSION_MODEL_ID) {
    return currentModel;
  }
  return sessionScenarioModel?.trim() || fallback;
}
