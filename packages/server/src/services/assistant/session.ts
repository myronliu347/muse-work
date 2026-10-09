import fs from "node:fs";
import path from "node:path";
import type { Session, SessionStore } from "../sessionStore.js";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt.js";

export const ASSISTANT_DISALLOWED_TOOLS = ["Workflow", "AskUserQuestion"] as const;

export const ASSISTANT_TITLE = "Muse Bot";

export function ensureAssistantSession(
  store: SessionStore,
  args: { home: string; model: string },
): Session {
  const existing = store.list().find((session) => session.origin === "assistant");
  if (existing) {
    const promptOk = existing.systemPrompt === ASSISTANT_SYSTEM_PROMPT;
    const toolsOk = !existing.tools || existing.tools.length === 0;
    const denyOk =
      JSON.stringify(existing.disallowedTools ?? []) ===
      JSON.stringify(ASSISTANT_DISALLOWED_TOOLS);
    const titleOk = existing.title === ASSISTANT_TITLE;
    if (promptOk && toolsOk && denyOk && titleOk) return existing;
    return (
      store.update(existing.id, {
        ...(promptOk ? {} : { systemPrompt: ASSISTANT_SYSTEM_PROMPT }),
        ...(toolsOk ? {} : { tools: undefined }),
        ...(denyOk ? {} : { disallowedTools: [...ASSISTANT_DISALLOWED_TOOLS] }),
        ...(titleOk ? {} : { title: ASSISTANT_TITLE }),
      }) ?? existing
    );
  }
  const workdir = path.join(args.home, "assistant-chat");
  fs.mkdirSync(workdir, { recursive: true });
  return store.create({
    origin: "assistant",
    workdir,
    permissionMode: "bypassPermissions",
    title: ASSISTANT_TITLE,
    model: args.model,
    systemPrompt: ASSISTANT_SYSTEM_PROMPT,
    disallowedTools: [...ASSISTANT_DISALLOWED_TOOLS],
  });
}
