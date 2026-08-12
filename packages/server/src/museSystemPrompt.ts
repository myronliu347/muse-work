/**
 * Replace Wave/NetEase identity wording with Muse Work after the SDK builds
 * its system prompt (MODEL_IDENTITY_PROMPT is always appended and cannot be
 * disabled via AgentOptions).
 */

export const MUSE_BASE_SYSTEM_PROMPT = `You are Muse Work, an AI coding assistant that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.`;

const MUSE_IDENTITY_PROMPT = `# Model identity

If asked about your model, model version, underlying architecture, or product name, identify yourself as Muse Work, an AI coding assistant. When helpful, you may mention the model currently selected in the Muse Work UI. Do not identify yourself as a NetEase or Wave coding agent.`;

export type PromptBlock = { text?: string; cacheable?: boolean };

export function rewritePromptBlocksForMuse(blocks: PromptBlock[]): PromptBlock[] {
  return blocks.map((block) => {
    if (typeof block.text !== "string") return block;
    return {
      ...block,
      text: block.text
        .replace(
          /You are a coding agent developed by NetEase that helps users with software engineering tasks\./g,
          "You are Muse Work, an AI coding assistant that helps users with software engineering tasks.",
        )
        .replace(
          /# Model identity\n\n[\s\S]*?(?=\n# [A-Z]|\n\n# [A-Z]|$)/,
          `${MUSE_IDENTITY_PROMPT}\n\n`,
        ),
    };
  });
}

/** Patch Agent.aiManager.buildMainSystemPrompt to rewrite NetEase identity. */
export function patchAgentSystemPrompt(agent: {
  aiManager?: {
    buildMainSystemPrompt?: (...args: unknown[]) => Promise<PromptBlock[]>;
  };
}): void {
  const ai = agent.aiManager;
  if (!ai?.buildMainSystemPrompt) return;
  const original = ai.buildMainSystemPrompt.bind(ai);
  ai.buildMainSystemPrompt = async (...args: unknown[]) => {
    const blocks = await original(...args);
    return rewritePromptBlocksForMuse(blocks);
  };
}
