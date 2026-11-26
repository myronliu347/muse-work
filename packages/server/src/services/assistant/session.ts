import fs from "node:fs";
import path from "node:path";
import { resolveScenarioModel } from "../agentConfig.js";
import type { Session, SessionStore } from "../sessionStore.js";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt.js";

/** 协调工具，加上查改文件、抓网页、Tavily 搜索，以及 Skill 和 Bash。 */
export const ASSISTANT_TOOLS = [
  "ListIssues",
  "GetIssue",
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
  "RecordProgress",
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

export const ASSISTANT_TITLE = "小盏";

/**
 * The assistant's working directory. Dev uses a separate folder so its
 * learned rules/skills and transcript never mix with a production install;
 * MUSE_ASSISTANT_WORKDIR overrides both for tests or custom setups.
 */
export function resolveAssistantWorkdir(home: string): string {
  const override = process.env.MUSE_ASSISTANT_WORKDIR?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.join(home, override);
  }
  const devHome =
    Boolean(process.env.MUSE_HOME_DIR) &&
    process.env.MUSE_HOME_DIR !== ".muse-work";
  return path.join(home, devHome ? "dev-assistant-chat" : "assistant-chat");
}

export function ensureAssistantSession(
  store: SessionStore,
  args: { home: string; systemPrompt?: string; toolNames?: readonly string[] },
): Session {
  const model = resolveScenarioModel("assistant", args.home);
  const systemPrompt = args.systemPrompt ?? ASSISTANT_SYSTEM_PROMPT;
  const toolNames = args.toolNames ?? ASSISTANT_TOOLS;
  const workdir = resolveAssistantWorkdir(args.home);
  fs.mkdirSync(workdir, { recursive: true });
  const existing = store.list().find((session) => session.origin === "assistant");
  if (existing) {
    const workdirOk = existing.workdir === workdir;
    const promptOk = existing.systemPrompt === systemPrompt;
    const toolsOk = JSON.stringify(existing.tools ?? []) === JSON.stringify(toolNames);
    const denyOk = !existing.disallowedTools?.length;
    const titleOk = existing.title === ASSISTANT_TITLE;
    const modelOk = existing.model === model;
    if (promptOk && toolsOk && denyOk && titleOk && modelOk && workdirOk) {
      return existing;
    }
    return (
      store.update(existing.id, {
        ...(workdirOk ? {} : { workdir }),
        ...(promptOk ? {} : { systemPrompt }),
        ...(toolsOk ? {} : { tools: [...toolNames] }),
        ...(denyOk ? {} : { disallowedTools: undefined }),
        ...(titleOk ? {} : { title: ASSISTANT_TITLE }),
        ...(modelOk ? {} : { model }),
      }) ?? existing
    );
  }
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
