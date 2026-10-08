import fs from "node:fs";
import path from "node:path";
import type { Session, SessionStore } from "../sessionStore.js";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt.js";

export const ASSISTANT_TOOL_NAMES = [
  "ListIssues",
  "ListWorkdirs",
  "CreateIssue",
  "OpenIssue",
  "MessageIssue",
  "SendMessage",
  "ReadSessionMessages",
  "ListMuseMessages",
] as const;

export function ensureAssistantSession(
  store: SessionStore,
  args: { home: string; model: string },
): Session {
  const existing = store.list().find((session) => session.origin === "assistant");
  if (existing) {
    const tools = [...ASSISTANT_TOOL_NAMES];
    const promptOk = existing.systemPrompt === ASSISTANT_SYSTEM_PROMPT;
    const toolsOk = JSON.stringify(existing.tools ?? []) === JSON.stringify(tools);
    if (promptOk && toolsOk) return existing;
    return (
      store.update(existing.id, {
        ...(promptOk ? {} : { systemPrompt: ASSISTANT_SYSTEM_PROMPT }),
        ...(toolsOk ? {} : { tools }),
      }) ?? existing
    );
  }
  const workdir = path.join(args.home, "assistant-chat");
  fs.mkdirSync(workdir, { recursive: true });
  return store.create({
    origin: "assistant",
    workdir,
    permissionMode: "bypassPermissions",
    title: "助理",
    model: args.model,
    systemPrompt: ASSISTANT_SYSTEM_PROMPT,
    tools: [...ASSISTANT_TOOL_NAMES],
  });
}
