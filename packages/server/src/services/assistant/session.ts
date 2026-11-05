import fs from "node:fs";
import path from "node:path";
import { resolveScenarioModel } from "../agentConfig.js";
import type { Session, SessionStore } from "../sessionStore.js";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt.js";

/** 协调工具，加上查改文件、抓网页、Tavily 搜索，以及 Skill 和 Bash。 */
export const ASSISTANT_TOOLS = [
  "ListIssues",
  "ListWorkdirs",
  "CreateIssue",
  "UpdateIssue",
  "OpenIssue",
  "MessageIssue",
  "AskIssue",
  "AbortMessageIssue",
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
  "WebFetch",
  "WebSearch",
] as const;

export const ASSISTANT_TITLE = "灵光";

export function ensureAssistantSession(
  store: SessionStore,
  args: { home: string; systemPrompt?: string; toolNames?: readonly string[] },
): Session {
  const model = resolveScenarioModel("assistant", args.home);
  const systemPrompt = args.systemPrompt ?? ASSISTANT_SYSTEM_PROMPT;
  const toolNames = args.toolNames ?? ASSISTANT_TOOLS;
  const existing = store.list().find((session) => session.origin === "assistant");
  if (existing) {
    const promptOk = existing.systemPrompt === systemPrompt;
    const toolsOk = JSON.stringify(existing.tools ?? []) === JSON.stringify(toolNames);
    const denyOk = !existing.disallowedTools?.length;
    const titleOk = existing.title === ASSISTANT_TITLE;
    const modelOk = existing.model === model;
    if (promptOk && toolsOk && denyOk && titleOk && modelOk) return existing;
    return (
      store.update(existing.id, {
        ...(promptOk ? {} : { systemPrompt }),
        ...(toolsOk ? {} : { tools: [...toolNames] }),
        ...(denyOk ? {} : { disallowedTools: undefined }),
        ...(titleOk ? {} : { title: ASSISTANT_TITLE }),
        ...(modelOk ? {} : { model }),
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
    model,
    systemPrompt,
    tools: [...toolNames],
  });
}
