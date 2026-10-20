const SPLIT_STATUS_LABEL: Record<string, string> = {
  pending: "待规划",
  planning: "规划中",
  executing: "执行中",
  review: "待审核",
  awaiting_close: "待关闭",
};

/** 单会话的状态跟着会话走。拆分模式仍用 Issue 自己的状态。 */
export function issueSidebarStatusLabel(group: {
  status: string;
  agentMode?: string;
  running?: boolean;
  sessionStatus?: string;
}): string {
  if (group.agentMode === "single") {
    if (group.status === "awaiting_close") return "待关闭";
    if (group.running || group.sessionStatus === "running") return "进行中";
    if (group.sessionStatus === "error") return "失败";
    return "空闲";
  }
  return SPLIT_STATUS_LABEL[group.status] ?? group.status;
}
