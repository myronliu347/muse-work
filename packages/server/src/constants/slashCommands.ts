export const SYSTEM_SLASH_COMMANDS = [
  { id: "compact", name: "compact", description: "压缩会话上下文" },
  { id: "clear", name: "clear", description: "清空当前会话" },
  { id: "rewind", name: "rewind", description: "回滚到检查点" },
  { id: "mcp", name: "mcp", description: "MCP 服务器" },
  { id: "status", name: "status", description: "会话状态" },
  { id: "tasks", name: "tasks", description: "后台任务" },
  { id: "workflows", name: "workflows", description: "工作流" },
] as const;
