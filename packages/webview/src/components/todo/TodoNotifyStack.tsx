import React, { useEffect } from "react";
import type { MuseTodoPriority } from "../../muse/apiClient";
import {
  TodoNotification,
  useTodoBoardStore,
} from "../../stores/todoBoardStore";
import "../../styles/TodoNotify.css";

const NOTIFY_TTL_MS = 8000;

const priorityColor = (p: string): "red" | "orange" | "gray" =>
  p === "p0" ? "red" : p === "p1" ? "orange" : "gray";

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

/** 右上角通知组件：task 进待审核（原型定稿 A，对齐 ToastStack 通道形态）。 */
export const TodoNotifyStack: React.FC<{
  onOpen: (notification: TodoNotification) => void;
}> = ({ onOpen }) => {
  const notifications = useTodoBoardStore((s) => s.notifications);
  const dismissNotification = useTodoBoardStore((s) => s.dismissNotification);

  // 8s 自动消失（每条独立计时）
  useEffect(() => {
    const timers = notifications.map((n) =>
      setTimeout(() => dismissNotification(n.id), NOTIFY_TTL_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [notifications, dismissNotification]);

  if (notifications.length === 0) return null;

  return (
    <div className="todo-notify-stack" data-testid="todo-notify-stack">
      {notifications.map((n) => (
        <button
          key={n.id}
          type="button"
          className="todo-notify-card"
          onClick={() => {
            dismissNotification(n.id);
            onOpen(n);
          }}
        >
          <div className="todo-notify-head">
            <span className="todo-notify-title">Muse · 任务待审核</span>
            <span className="todo-notify-time">{fmtTime(n.createdAt)}</span>
          </div>
          <div className="todo-notify-body">
            <span
              className={`todo-notify-priority todo-notify-priority-${n.priority}`}
            >
              {n.priority.toUpperCase()}
            </span>
            <span className="todo-notify-text">
              {n.todoTitle} · {n.taskTitle} 待审核
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};
