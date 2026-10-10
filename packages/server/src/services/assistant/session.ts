import fs from "node:fs";
import path from "node:path";
import type { Session, SessionStore } from "../sessionStore.js";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt.js";

/** 协调工具，加上查改文件、子代理、抓网页，以及建自动化需要的 Skill 和 Bash。 */
export const ASSISTANT_TOOLS = [
  "ListIssues",
  "ListWorkdirs",
  "CreateIssue",
  "OpenIssue",
  "MessageIssue",
  "CloseIssue",
  "ResolvePermission",
  "SendMessage",
  "ReadSessionMessages",
  "ListMuseMessages",
  "Skill",
  "Bash",
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "Agent",
  "WebFetch",
] as const;

export const ASSISTANT_TITLE = "Muse Bot";

export function ensureAssistantSession(
  store: SessionStore,
  args: { home: string; model: string },
): Session {
  const existing = store.list().find((session) => session.origin === "assistant");
  if (existing) {
    const promptOk = existing.systemPrompt === ASSISTANT_SYSTEM_PROMPT;
    const toolsOk = JSON.stringify(existing.tools ?? []) === JSON.stringify(ASSISTANT_TOOLS);
    const denyOk = !existing.disallowedTools?.length;
    const titleOk = existing.title === ASSISTANT_TITLE;
    if (promptOk && toolsOk && denyOk && titleOk) return existing;
    return (
      store.update(existing.id, {
        ...(promptOk ? {} : { systemPrompt: ASSISTANT_SYSTEM_PROMPT }),
        ...(toolsOk ? {} : { tools: [...ASSISTANT_TOOLS] }),
        ...(denyOk ? {} : { disallowedTools: undefined }),
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
    tools: [...ASSISTANT_TOOLS],
  });
}
