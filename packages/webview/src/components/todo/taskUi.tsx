import React from "react";
import { Badge, Text } from "@radix-ui/themes";
import { marked } from "marked";
import type { MuseTaskStatus, MuseTodoPriority, MuseTodoStatus } from "../../muse/apiClient";
import { Tooltip } from "../shared/Tooltip";
import {
  TASK_STATUS_COLOR,
  TODO_SOURCE_LABEL,
  TODO_STATUS_COLOR,
  taskStatusLabel,
  todoStatusLabel,
} from "./taskLabels";

export function mdHtml(content: string): string {
  return marked.parse(content, { gfm: true, breaks: true }) as string;
}

export const PriorityBadge: React.FC<{ p: MuseTodoPriority }> = ({ p }) => (
  <Badge
    color={p === "p0" ? "red" : p === "p1" ? "orange" : "gray"}
    variant="soft"
    size="1"
  >
    {p.toUpperCase()}
  </Badge>
);

export const TodoStatusBadge: React.FC<{ status: MuseTodoStatus }> = ({ status }) => (
  <Badge color={TODO_STATUS_COLOR[status] ?? "gray"} variant="soft" size="1">
    {todoStatusLabel(status)}
  </Badge>
);

export const TaskStatusBadge: React.FC<{ status: MuseTaskStatus }> = ({ status }) => (
  <Badge color={TASK_STATUS_COLOR[status] ?? "gray"} variant="soft" size="1">
    {taskStatusLabel(status)}
  </Badge>
);

export const SourceTag: React.FC<{ source: string }> = ({ source }) => (
  <Text size="1" color="gray" className="todo-source">
    {TODO_SOURCE_LABEL[source as keyof typeof TODO_SOURCE_LABEL] ?? source}
  </Text>
);

/** 图标操作按钮 + Tooltip（prototype A 定稿：图标按钮 + tooltip 具体文案） */
export const IconBtn: React.FC<{
  icon: string;
  tip: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  testId?: string;
}> = ({ icon, tip, onClick, primary, disabled, testId }) => (
  <Tooltip text={tip} position="top" wrap={false}>
    <button
      type="button"
      className={`todo-icon-btn${primary ? " todo-icon-btn-primary" : ""}`}
      disabled={disabled}
      aria-label={tip}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick?.();
      }}
      data-testid={testId}
    >
      <i className={`codicon codicon-${icon}`} />
    </button>
  </Tooltip>
);
