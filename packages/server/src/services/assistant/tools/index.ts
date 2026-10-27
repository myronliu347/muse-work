import { createWebSearchTool } from "../webSearchTool.js";
import { createIssueTools } from "./issueTools.js";
import { createMessageTools } from "./messageTools.js";
import type { AssistantToolDeps } from "./toolKit.js";

export type { AssistantToolDeps } from "./toolKit.js";

export function createAssistantTools(deps: AssistantToolDeps) {
  return [
    ...createIssueTools(deps),
    ...createMessageTools(deps),
    createWebSearchTool({ home: deps.home, tavily: deps.tavily }),
  ];
}
