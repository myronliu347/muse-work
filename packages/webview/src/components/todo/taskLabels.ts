import type {
  MuseTaskStatus,
  MuseTodoSource,
  MuseTodoStatus,
} from "../../muse/apiClient";

/** Todo/Task 英文枚举 → 中文展示文案（server 存英文枚举，前端映射展示）。 */

export const TODO_SOURCE_LABEL: Record<MuseTodoSource, string> = {
  session: "会话",
  manual: "手动创建",
  popo: "POPO 任务",
  internal: "内部管理平台",
};

export const TODO_STATUS_LABEL: Record<MuseTodoStatus, string> = {
  pending: "待执行",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};

export const TASK_STATUS_LABEL: Record<MuseTaskStatus, string> = {
  pending: "待执行",
  running: "执行中",
  review: "待审核",
  completed: "已完成",
  cancelled: "已取消",
};

export const TODO_STATUS_COLOR: Record<MuseTodoStatus, "gray" | "blue" | "green" | "red"> = {
  pending: "gray",
  in_progress: "blue",
  completed: "green",
  cancelled: "red",
};

export const TASK_STATUS_COLOR: Record<MuseTaskStatus, "gray" | "blue" | "amber" | "green" | "red"> = {
  pending: "gray",
  running: "blue",
  review: "amber",
  completed: "green",
  cancelled: "red",
};

/** 看板列顺序（已取消归档不显示）。 */
export const TASK_STATUS_ORDER: MuseTaskStatus[] = ["pending", "running", "review", "completed"];

export function todoSourceLabel(source: MuseTodoSource): string {
  return TODO_SOURCE_LABEL[source] ?? source;
}

export function todoStatusLabel(status: MuseTodoStatus): string {
  return TODO_STATUS_LABEL[status] ?? status;
}

export function taskStatusLabel(status: MuseTaskStatus): string {
  return TASK_STATUS_LABEL[status] ?? status;
}
