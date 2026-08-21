import React, { useEffect, useRef, useState } from "react";
import { QueueChevronIcon } from "../shared/HeaderIcons";
import type { BackgroundTaskSummary } from "../../types";
import "../../styles/BackgroundTaskList.css";

interface BackgroundTaskListProps {
  tasks: BackgroundTaskSummary[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** 停止运行中的后台任务（按钮只在任务 running 时出现）。 */
  onStopTask?: (taskId: string) => void;
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const STATUS_COLORS: Record<string, string> = {
  running: "var(--accent-11)",
  completed: "var(--green-11)",
  failed: "#f48771",
  killed: "#dcdcaa",
};

const STATUS_LABELS: Record<string, string> = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  killed: "已终止",
};

export const BackgroundTaskList: React.FC<BackgroundTaskListProps> = ({
  tasks,
  isCollapsed,
  onToggleCollapse,
  onStopTask,
}) => {
  const [autoHidden, setAutoHidden] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const prevTasksRef = useRef<BackgroundTaskSummary[]>(tasks);
  // 是否在当前展示期间观察到过非全部完成的任务；用于区分"任务在眼前完成"
  // 与"加载时已全部完成"（后者立即隐藏，避免先闪现再消失）。
  const hadIncompleteRef = useRef(false);
  const itemsRef = useRef<HTMLDivElement>(null);

  const allCompleted =
    tasks.length > 0 && tasks.every((t) => t.status === "completed");

  // 新任务出现时滚动到最后一项，保证 sender 上方的实时进度可见
  useEffect(() => {
    const prev = prevTasksRef.current;
    const newTask = tasks.find(
      (t) => !prev.some((p) => p.id === t.id) && t.status === "running",
    );
    prevTasksRef.current = tasks;
    if (newTask && !isCollapsed && itemsRef.current) {
      const el = itemsRef.current.querySelector(
        `[data-task-id="${newTask.id}"]`,
      );
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [tasks, isCollapsed]);

  // 从"存在未完成（含失败/终止）"变为"全部完成"时保留 5 秒再隐藏；
  // 加载或切换到已全部完成的会话时立即隐藏。
  useEffect(() => {
    if (tasks.length === 0) {
      hadIncompleteRef.current = false;
      return;
    }
    if (!allCompleted) {
      hadIncompleteRef.current = true;
      setAutoHidden(false);
      return;
    }
    if (!hadIncompleteRef.current) {
      setAutoHidden(true);
      return;
    }
    const timer = setTimeout(() => setAutoHidden(true), 5000);
    return () => clearTimeout(timer);
  }, [allCompleted, tasks.length]);

  if (tasks.length === 0 || autoHidden) {
    return null;
  }

  const total = tasks.length;
  const running = tasks.filter((t) => t.status === "running").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter(
    (t) => t.status === "failed" || t.status === "killed",
  ).length;

  const stats = [
    { count: running, label: "进行中", color: STATUS_COLORS.running },
    { count: completed, label: "已完成", color: STATUS_COLORS.completed },
    { count: failed, label: "失败", color: STATUS_COLORS.failed },
  ];

  const handleStop = (taskId: string) => {
    setStoppingId(taskId);
    onStopTask?.(taskId);
  };

  return (
    <div className="background-task-list" data-testid="background-task-list">
      <div
        className="background-task-list-header"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "展开后台任务" : "折叠后台任务"}
      >
        <div className="background-task-list-header-left">
          <QueueChevronIcon
            className={`background-task-chevron${isCollapsed ? "" : " expanded"}`}
          />
          <span className="background-task-list-title">
            后台任务 ({total})
          </span>
        </div>
        <div className="background-task-list-stats">
          {stats.map((s) => (
            <div key={s.label} className="background-task-stat">
              <span
                className="background-task-stat-dot"
                style={{ backgroundColor: s.color }}
              />
              <span className="background-task-stat-text">
                {s.label} {s.count}
              </span>
            </div>
          ))}
        </div>
      </div>
      {!isCollapsed && (
        <div className="background-task-items" ref={itemsRef}>
          {tasks.map((task) => (
            <div
              key={task.id}
              className="background-task-row"
              data-task-id={task.id}
            >
              <span
                className={`background-task-status-dot${
                  task.status === "running" ? " running" : ""
                }`}
                style={{
                  backgroundColor: STATUS_COLORS[task.status],
                }}
                title={STATUS_LABELS[task.status]}
              />
              <div className="background-task-content">
                <div className="background-task-title">
                  {(task.description || task.command || task.id).trim()}
                </div>
                {task.command && task.command !== task.description && (
                  <div className="background-task-command">$ {task.command}</div>
                )}
                <div className="background-task-meta">
                  {task.status === "running"
                    ? task.runtime !== undefined
                      ? `已运行 ${formatDuration(task.runtime)}`
                      : "进行中"
                    : `${STATUS_LABELS[task.status]}`}
                  {task.exitCode !== undefined &&
                    ` · exit ${task.exitCode}`}
                  {task.type === "subagent" && " · subagent"}
                </div>
              </div>
              {task.status === "running" && onStopTask && (
                <button
                  className="background-task-stop-btn"
                  onClick={() => handleStop(task.id)}
                  disabled={stoppingId === task.id}
                  data-testid={`background-task-stop-${task.id}`}
                >
                  {stoppingId === task.id ? "停止中..." : "停止"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
