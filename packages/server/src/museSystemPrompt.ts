/**
 * Replace Wave/NetEase identity wording with Muse after the SDK builds
 * its system prompt (MODEL_IDENTITY_PROMPT is always appended and cannot be
 * disabled via AgentOptions).
 */

export const MUSE_BASE_SYSTEM_PROMPT = `You are Muse, an AI coding assistant that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.`;

/** Bump when identity wording changes so sessionRunner recreates agents. */
export const MUSE_IDENTITY_REV = "3";

export function buildMuseIdentityPrompt(modelDisplay: string): string {
  const name = modelDisplay.trim() || "unknown";
  return `# Model identity

If asked about your model, model version, underlying architecture, or product name, identify yourself as Muse, an AI coding assistant. The model currently selected for this session is ${name}. When asked which model you are using, answer with exactly that name. Do not invent, guess, or substitute a different model name (for example do not say Claude Opus unless that is the selected name). Do not identify yourself as a NetEase or Wave coding agent.`;
}

export type PromptBlock = { text?: string; cacheable?: boolean };

export function rewritePromptBlocksForMuse(
  blocks: PromptBlock[],
  options?: { modelDisplay?: string },
): PromptBlock[] {
  const identity = buildMuseIdentityPrompt(options?.modelDisplay ?? "unknown");
  return blocks.map((block) => {
    if (typeof block.text !== "string") return block;
    return {
      ...block,
      text: block.text
        .replace(
          /You are a coding agent developed by NetEase that helps users with software engineering tasks\./g,
          "You are Muse, an AI coding assistant that helps users with software engineering tasks.",
        )
        .replace(
          /# Model identity\n\n[\s\S]*?(?=\n# [A-Z]|\n\n# [A-Z]|$)/,
          `${identity}\n\n`,
        ),
    };
  });
}

/** Patch Agent.aiManager.buildMainSystemPrompt to rewrite NetEase identity. */
export function patchAgentSystemPrompt(
  agent: {
    aiManager?: {
      buildMainSystemPrompt?: (...args: unknown[]) => Promise<PromptBlock[]>;
    };
  },
  options?: { modelDisplay?: string },
): void {
  const ai = agent.aiManager;
  if (!ai?.buildMainSystemPrompt) return;
  const original = ai.buildMainSystemPrompt.bind(ai);
  ai.buildMainSystemPrompt = async (...args: unknown[]) => {
    const blocks = await original(...args);
    return rewritePromptBlocksForMuse(blocks, options);
  };
}
