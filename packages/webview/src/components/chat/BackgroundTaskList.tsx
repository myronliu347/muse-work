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

export const BackgroundTaskList: React.FC<BackgroundTaskListProps> = ({
  tasks,
  isCollapsed,
  onToggleCollapse,
  onStopTask,
}) => {
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const prevTasksRef = useRef<BackgroundTaskSummary[]>(tasks);
  const itemsRef = useRef<HTMLDivElement>(null);

  const runningTasks = tasks.filter((t) => t.status === "running");

  // 新任务出现时滚动到最后一项，保证 sender 上方的实时进度可见
  useEffect(() => {
    const prev = prevTasksRef.current;
    const newTask = runningTasks.find(
      (t) => !prev.some((p) => p.id === t.id),
    );
    prevTasksRef.current = tasks;
    if (newTask && !isCollapsed && itemsRef.current) {
      const el = itemsRef.current.querySelector(
        `[data-task-id="${newTask.id}"]`,
      );
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [tasks, runningTasks, isCollapsed]);

  if (runningTasks.length === 0) {
    return null;
  }

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
            后台任务 ({runningTasks.length})
          </span>
        </div>
      </div>
      <div
        className={`background-task-collapse${isCollapsed ? " background-task-collapse--closed" : ""}`}
      >
        <div className="background-task-collapse-inner">
        <div className="background-task-items" ref={itemsRef}>
          {runningTasks.map((task) => (
            <div
              key={task.id}
              className="background-task-row"
              data-task-id={task.id}
            >
              <span
                className="background-task-status-dot running"
                style={{ backgroundColor: "var(--accent-11)" }}
                title="进行中"
              />
              <div className="background-task-content">
                <div className="background-task-title">
                  {(task.description || task.command || task.id).trim()}
                </div>
                {task.command && task.command !== task.description && (
                  <div className="background-task-command">$ {task.command}</div>
                )}
                <div className="background-task-meta">
                  {task.runtime !== undefined
                    ? `已运行 ${formatDuration(task.runtime)}`
                    : "进行中"}
                  {task.type === "subagent" && " · subagent"}
                </div>
              </div>
              {onStopTask && (
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
        </div>
      </div>
    </div>
  );
};
