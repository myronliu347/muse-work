import React, { useState, useEffect, useRef } from "react";
import { WorkflowManagerProps, SerializableWorkflowRun } from "../../types";
import { ConfigurationDialogClose } from "../dialogs/ConfigurationDialogClose";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import "../../styles/ConfigurationDialog.css";

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
};

const formatTokens = (tokens: number): string => {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
};

const statusColor = (status: string): string => {
  switch (status) {
    case "running":
      return "var(--status-progress-text)";
    case "completed":
      return "var(--status-success-text)";
    case "failed":
    case "aborted":
      return "var(--status-danger-text)";
    case "paused":
      return "var(--status-warning-text)";
    default:
      return "var(--text-secondary)";
  }
};

const WorkflowManager: React.FC<
  WorkflowManagerProps & {
    runs: SerializableWorkflowRun[];
    vscode: { postMessage: (msg: unknown) => void };
    onOpenFile?: (path: string) => void;
  }
> = ({ onCancel, runs, vscode, onOpenFile }) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef);

  const runningRuns = runs.filter((run) => run.status === "running");
  const selectedRun =
    runningRuns.find((r) => r.runId === selectedRunId) || null;

  useEffect(() => {
    vscode?.postMessage({ command: "getWorkflowRuns" });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "workflowRunStopped") {
        setStoppingId(null);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleStop = (runId: string) => {
    setStoppingId(runId);
    vscode.postMessage({ command: "stopWorkflowRun", runId });
  };

  const handleOpenScript = (path: string) => {
    if (!path) return;
    if (onOpenFile) onOpenFile(path);
    else vscode.postMessage({ command: "openFile", path });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        onCancel();
      }
    };
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (selectedRunId) {
          setSelectedRunId(null);
        } else {
          onCancel();
        }
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    document.addEventListener("keydown", handleEscapeKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [onCancel, selectedRunId]);

  const renderDetail = () => {
    if (!selectedRun) return null;
    const elapsed = selectedRun.endTime
      ? selectedRun.endTime - selectedRun.startTime
      : Date.now() - selectedRun.startTime;

    return (
      <div className="mcp-server-list">
        <div className="mcp-server-item">
          <div className="mcp-server-info">
            <div className="mcp-server-header">
              <span style={{ color: statusColor(selectedRun.status) }}>●</span>
              <span className="mcp-server-name">{selectedRun.meta?.name}</span>
              <span
                style={{
                  color: statusColor(selectedRun.status),
                  fontSize: "12px",
                }}
              >
                {selectedRun.status}
              </span>
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "var(--text-primary)" }}>Run ID:</span>{" "}
              {selectedRun.runId}
            </div>
            {selectedRun.meta?.description && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>Description:</span>{" "}
                {selectedRun.meta.description}
              </div>
            )}
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "var(--text-primary)" }}>Started:</span>{" "}
              {formatTime(selectedRun.startTime)}
              {selectedRun.endTime && (
                <>
                  {" | "}
                  <span style={{ color: "var(--text-primary)" }}>Ended:</span>{" "}
                  {formatTime(selectedRun.endTime)}
                </>
              )}
              {" | "}
              <span style={{ color: "var(--text-primary)" }}>Duration:</span>{" "}
              {formatDuration(elapsed)}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ color: "var(--text-primary)" }}>Agents:</span>{" "}
              {selectedRun.totalAgents}
              {" | "}
              <span style={{ color: "var(--text-primary)" }}>Tokens:</span>{" "}
              {formatTokens(selectedRun.totalTokens)}
            </div>
            {selectedRun.scriptPath && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  wordBreak: "break-all",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>Script:</span>{" "}
                <button
                  type="button"
                  className="workflow-script-path"
                  data-testid="workflow-script-path"
                  title="打开脚本"
                  onClick={() => handleOpenScript(selectedRun.scriptPath)}
                >
                  {selectedRun.scriptPath}
                </button>
              </div>
            )}
            {selectedRun.error && (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--status-danger-text)",
                  wordBreak: "break-all",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>Error:</span>{" "}
                {selectedRun.error}
              </div>
            )}
          </div>
          <div className="mcp-server-actions">
            {selectedRun.status === "running" && (
              <button
                className="mcp-disconnect-btn"
                onClick={() => handleStop(selectedRun.runId)}
                disabled={stoppingId === selectedRun.runId}
              >
                {stoppingId === selectedRun.runId ? "停止中..." : "停止"}
              </button>
            )}
          </div>
        </div>

        {selectedRun.phases?.length ? (
          <div style={{ marginTop: "12px" }}>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-primary)",
                marginBottom: "4px",
              }}
            >
              Phases:
            </div>
            {selectedRun.phases.map((phase, i) => (
              <div
                key={i}
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  marginLeft: "8px",
                  marginBottom: "2px",
                }}
              >
                <span style={{ color: "var(--text-primary)" }}>{phase.title}</span>
                {" — "}
                {phase.agentCount} agents | {formatTokens(phase.tokens)} tokens
                | {formatDuration(phase.elapsed)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderList = () => (
    <div className="mcp-server-list">
      {runningRuns.map((run) => {
        const elapsed = run.endTime
          ? run.endTime - run.startTime
          : Date.now() - run.startTime;
        const phases = run.phases ?? [];
        const phaseText = phases.map((p) => p.title).join(" → ");
        return (
          <div
            key={run.runId}
            className="mcp-server-item"
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedRunId(run.runId)}
          >
            <div className="mcp-server-info">
              <div className="mcp-server-header">
                <span style={{ color: statusColor(run.status) }}>●</span>
                <span className="mcp-server-name">
                  [{run.runId.slice(0, 8)}] {run.meta?.name}
                </span>
                <span
                  style={{ color: statusColor(run.status), fontSize: "12px" }}
                >
                  {run.status}
                </span>
              </div>
              {run.meta?.description && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  {run.meta.description}
                </div>
              )}
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                }}
              >
                {run.totalAgents} agents · {formatTokens(run.totalTokens)}{" "}
                tokens · {formatDuration(elapsed)}
              </div>
              {phaseText && (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                  }}
                >
                  {phases.map((p, pi) => (
                    <React.Fragment key={pi}>
                      {pi > 0 && " → "}
                      {p.title}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
            <div className="mcp-server-actions">
              {run.status === "running" && (
                <button
                  className="mcp-disconnect-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStop(run.runId);
                  }}
                  disabled={stoppingId === run.runId}
                >
                  {stoppingId === run.runId ? "停止中..." : "停止"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-manager-title"
        data-testid="workflow-manager"
        style={{ maxWidth: "760px" }}
      >
        <div className="configuration-dialog-header">
          <h3 id="workflow-manager-title">工作流</h3>
          <ConfigurationDialogClose onClick={onCancel} />
        </div>

        <div className="mcp-container">
          {runningRuns.length === 0 ? (
            <div className="empty-state">
              <p>暂无工作流运行</p>
            </div>
          ) : selectedRun ? (
            renderDetail()
          ) : (
            renderList()
          )}

          <div className="configuration-actions">
            {selectedRun && (
              <button
                type="button"
                onClick={() => setSelectedRunId(null)}
                className="configuration-cancel-btn"
              >
                返回列表
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowManager;
