import { createWebSearchTool } from "../webSearchTool.js";
import { createIssueTools } from "./issueTools.js";
import { createMessageTools } from "./messageTools.js";
import { compactText, tool, type AssistantToolDeps } from "./toolKit.js";

export type { AssistantToolDeps } from "./toolKit.js";

export function createAssistantTools(deps: AssistantToolDeps) {
  const extras = (deps.extraTools ?? []).map((entry) =>
    tool(
      entry.name,
      entry.description,
      entry.parameters,
      (args) => entry.execute(args),
      (params) => compactText(params.msgId) || compactText(params.message),
    ),
  );
  return [
    ...createIssueTools(deps),
    ...createMessageTools(deps),
    ...extras,
    createWebSearchTool({ home: deps.home, tavily: deps.tavily }),
  ];
}
