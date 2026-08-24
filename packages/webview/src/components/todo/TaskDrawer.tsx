import React, { useCallback, useState } from "react";
import { Button, Text, TextArea } from "@radix-ui/themes";
import type { MuseApiClient, MuseRun, MuseTask } from "../../muse/apiClient";
import {
  useSelectedComments,
  useSelectedRuns,
  useSelectedTask,
  useTodoBoardStore,
} from "../../stores/todoBoardStore";
import { IconBtn, TaskStatusBadge, mdHtml } from "./taskUi";

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** 操作按钮组：按 task 状态渲染；开始执行/继续执行/取消/通过/打开执行会话已接线。 */
const TaskActions: React.FC<{
  task: MuseTask;
  onOpenExecutionSession?: (sessionId: string) => void;
  onTodosChanged?: () => void;
}> = ({ task, onOpenExecutionSession, onTodosChanged }) => {
  const enqueueTask = useTodoBoardStore((s) => s.enqueueTask);
  const cancelTask = useTodoBoardStore((s) => s.cancelTask);
  const approveTask = useTodoBoardStore((s) => s.approveTask);
  const closeTaskDrawer = useTodoBoardStore((s) => s.closeTaskDrawer);

  /** 操作成功（POST 通过）后自动收起抽屉并通知侧栏刷新（todo 状态可能联动变化）。 */
  const runAndClose = async (fn: () => Promise<boolean>) => {
    const ok = await fn();
    if (ok) {
      closeTaskDrawer();
      onTodosChanged?.();
    }
  };

  const openExec = () => {
    if (task.executionSessionId) onOpenExecutionSession?.(task.executionSessionId);
  };

  if (task.status === "review") {
    return (
      <>
        <IconBtn
          icon="check"
          tip="审核通过 → 已完成（保留 worktree 供排查，清理执行会话）"
          primary
          onClick={() => void runAndClose(() => approveTask(task.id))}
        />
        <IconBtn icon="refresh" tip="继续执行（回到执行中）" onClick={() => void runAndClose(() => enqueueTask(task.id))} />
        <IconBtn
          icon="comment-discussion"
          tip={task.executionSessionId ? "打开执行会话" : "尚未执行，无会话"}
          disabled={!task.executionSessionId}
          testId={`todo-open-exec-session-${task.id}`}
          onClick={openExec}
        />
        <IconBtn icon="close" tip="取消任务" onClick={() => void runAndClose(() => cancelTask(task.id))} />
      </>
    );
  }
  if (task.status === "pending") {
    return (
      <>
        <IconBtn
          icon="play"
          tip="开始执行（入队等待）"
          primary
          onClick={() => void runAndClose(() => enqueueTask(task.id))}
        />
        <IconBtn icon="close" tip="取消任务" onClick={() => void runAndClose(() => cancelTask(task.id))} />
      </>
    );
  }
  if (task.status === "running") {
    return (
      <>
        <IconBtn
          icon="comment-discussion"
          tip={task.executionSessionId ? "打开执行会话" : "尚未执行，无会话"}
          disabled={!task.executionSessionId}
          testId={`todo-open-exec-session-${task.id}`}
          onClick={openExec}
        />
        <IconBtn icon="close" tip="取消任务" onClick={() => void runAndClose(() => cancelTask(task.id))} />
      </>
    );
  }
  return null;
};

const OpenInButtons: React.FC<{
  task: MuseTask;
  onOpenInEditor?: (workdir: string) => void;
  onOpenInTerminal?: (workdir: string) => void;
}> = ({ task, onOpenInEditor, onOpenInTerminal }) => {
  // task.workdir 即最终工作目录（git 项目=worktree 路径，普通目录=原目录）
  const dir = task.workdir;
  return (
    <>
      <IconBtn
        icon="code"
        tip="在编辑器中打开 workdir"
        testId={`todo-open-editor-${task.id}`}
        onClick={() => onOpenInEditor?.(dir)}
      />
      <IconBtn
        icon="terminal"
        tip="在终端中打开 workdir"
        testId={`todo-open-terminal-${task.id}`}
        onClick={() => onOpenInTerminal?.(dir)}
      />
    </>
  );
};

const RunItem: React.FC<{ run: MuseRun }> = ({ run }) => {
  const label =
    run.status === "finished"
      ? `执行完成${run.finishedAt ? `（${fmtTime(run.finishedAt)}）` : ""}`
      : run.status === "running"
        ? `执行中${run.startedAt ? `（${fmtTime(run.startedAt)} 开始）` : ""}`
        : run.status === "canceled"
          ? "cancelled"
          : "排队等待";
  return (
    <div className="todo-thread-item todo-thread-system">
      <div className="todo-thread-meta">{label}</div>
    </div>
  );
};

/** 评论输入框：textarea + 发送，⌘/Ctrl+Enter 提交 */
const CommentComposer: React.FC<{ task: MuseTask }> = ({ task }) => {
  const addComment = useTodoBoardStore((s) => s.addComment);
  const [text, setText] = useState("");

  const submit = useCallback(() => {
    if (!text.trim()) return;
    void addComment(task.id, text);
    setText("");
  }, [addComment, task.id, text]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="todo-composer">
      <TextArea
        size="1"
        placeholder="添加评论…（支持 markdown）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        data-testid="todo-comment-input"
      />
      <Button
        size="1"
        onClick={submit}
        disabled={!text.trim()}
        data-testid="todo-comment-send"
      >
        发送
      </Button>
    </div>
  );
};

/** 详情抽屉（右侧滑出，prototype A 形态） */
export const TaskDrawer: React.FC<{
  api: MuseApiClient;
  onOpenExecutionSession?: (sessionId: string) => void;
  onOpenInEditor?: (workdir: string) => void;
  onOpenInTerminal?: (workdir: string) => void;
  onTodosChanged?: () => void;
}> = ({
  onOpenExecutionSession,
  onOpenInEditor,
  onOpenInTerminal,
  onTodosChanged,
}) => {
  const task = useSelectedTask();
  const comments = useSelectedComments();
  const runs = useSelectedRuns();
  const closeTaskDrawer = useTodoBoardStore((s) => s.closeTaskDrawer);
  const [editing, setEditing] = useState(false);

  if (!task) return null;

  return (
    <div className="todo-detail-mask" onClick={closeTaskDrawer} data-testid="todo-drawer">
      <div className="todo-detail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="todo-drawer-head">
          <span className="todo-drawer-title">{task.title}</span>
          <TaskStatusBadge status={task.status} />
          {task.status === "pending" && (
            <IconBtn icon="pencil" tip="编辑" onClick={() => setEditing((v) => !v)} />
          )}
          <IconBtn icon="close" tip="关闭" onClick={closeTaskDrawer} />
        </div>
        <div className="todo-detail-body">
          {editing ? (
            <TaskEditForm task={task} onDone={() => setEditing(false)} />
          ) : (
            <>
              <div>
                <div className="todo-drawer-section-title">执行环境</div>
                {task.description && (
                  <div
                    className="todo-task-desc"
                    dangerouslySetInnerHTML={{ __html: mdHtml(task.description) }}
                  />
                )}
                <Text size="1" color="gray" className="todo-mono">
                  {task.worktreeEnabled === false ? (
                    <>直接执行（未用 worktree） · {task.workdir}</>
                  ) : (
                    <>
                      worktree: {task.worktreeName ?? "未绑定"}
                      {task.workdir ? ` · ${task.workdir}` : ""}
                    </>
                  )}
                </Text>
              </div>
              <div className="todo-act-row">
                <TaskActions
                  task={task}
                  onOpenExecutionSession={onOpenExecutionSession}
                  onTodosChanged={onTodosChanged}
                />
                <span className="todo-act-sep" />
                <OpenInButtons
                  task={task}
                  onOpenInEditor={onOpenInEditor}
                  onOpenInTerminal={onOpenInTerminal}
                />
              </div>
              {runs.length > 0 && (
                <div>
                  <div className="todo-drawer-section-title">执行记录</div>
                  <div className="todo-thread">
                    {runs.map((r) => (
                      <RunItem key={r.id} run={r} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="todo-drawer-section-title">审核讨论</div>
                <div className="todo-thread">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className={`todo-thread-item ${
                        c.author === "ai" ? "todo-thread-ai" : c.author === "system" ? "todo-thread-system" : ""
                      }`}
                    >
                      <div className="todo-thread-meta">
                        {c.author === "user" ? "你" : c.author === "ai" ? "AI" : "系统"}
                        {c.kind === "result" ? " · 执行结果" : " · 评论"}
                        <span className="todo-thread-time">{fmtTime(c.createdAt)}</span>
                      </div>
                      <div
                        className="todo-task-desc"
                        dangerouslySetInnerHTML={{ __html: mdHtml(c.content) }}
                      />
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <Text size="1" color="gray">
                      暂无讨论
                    </Text>
                  )}
                </div>
                <CommentComposer task={task} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/** 编辑表单（task：标题/描述；仅待执行显示入口） */
const TaskEditForm: React.FC<{ task: MuseTask; onDone: () => void }> = ({ task, onDone }) => {
  const updateTask = useTodoBoardStore((s) => s.updateTask);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);

  const save = async () => {
    if (!title.trim()) return;
    const ok = await updateTask(task.id, {
      title: title.trim(),
      description,
    });
    if (ok) onDone();
  };

  return (
    <div className="todo-edit-form">
      <Text as="label" size="1" weight="medium">
        标题
        <input
          className="todo-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="todo-edit-title"
        />
      </Text>
      <Text as="label" size="1" weight="medium">
        描述（markdown）
        <TextArea
          size="1"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          data-testid="todo-edit-desc"
        />
      </Text>
      <div className="todo-edit-actions">
        <Button size="1" onClick={save} disabled={!title.trim()} data-testid="todo-edit-save">
          保存
        </Button>
        <Button size="1" variant="soft" onClick={onDone}>
          取消
        </Button>
      </div>
    </div>
  );
};
