import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, DropdownMenu, Flex, ScrollArea, Switch, Text, TextArea } from "@radix-ui/themes";
import type {
  MuseApiClient,
  MuseTodo,
  MuseTodoPriority,
} from "../../muse/apiClient";
import {
  useBoardTasks,
  useSelectedTodo,
  useTodoBoardStore,
} from "../../stores/todoBoardStore";
import { IconBtn, PriorityBadge, SourceTag, TaskStatusBadge, TodoStatusBadge, mdHtml } from "./taskUi";
import { Tooltip } from "../shared/Tooltip";
import { TaskDrawer } from "./TaskDrawer";
import { TASK_STATUS_ORDER } from "./taskLabels";
import "../../styles/TodoBoard.css";

/** 标签输入：逗号/空格分隔，解析后 trim + 小写 + 去重。 */
function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,，\s]+/)) {
    const tag = piece.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** 标签编辑器（编辑表单/新建表单共用）：已选 chips + 新标签输入 + 历史标签选择。 */
const TodoTagEditor: React.FC<{
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}> = ({ tags, allTags, onChange }) => {
  const [tagInput, setTagInput] = useState("");

  const addTypedTags = () => {
    const parsed = parseTagsInput(tagInput);
    if (parsed.length === 0) return;
    onChange([...tags, ...parsed.filter((t) => !tags.includes(t))]);
    setTagInput("");
  };

  const toggleTag = (tag: string) => {
    onChange(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);
  };

  return (
    <div className="todo-edit-tags">
      <div className="todo-tag-chips">
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="todo-tag-chip active"
            onClick={() => toggleTag(tag)}
            data-testid={`todo-edit-tag-chip-${tag}`}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="todo-edit-tags-input-row">
        <input
          className="todo-input"
          placeholder="新标签（逗号/空格分隔）"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTypedTags();
            }
          }}
          data-testid="todo-edit-tags-input"
        />
        <Button size="1" variant="soft" onClick={addTypedTags} data-testid="todo-edit-tags-add">
          添加
        </Button>
      </div>
      {allTags.filter((t) => !tags.includes(t)).length > 0 && (
        <div className="todo-edit-tags-history">
          <Text size="1" color="gray">
            历史标签：
          </Text>
          {allTags
            .filter((t) => !tags.includes(t))
            .map((tag) => (
              <button
                key={tag}
                type="button"
                className="todo-tag-chip"
                onClick={() => toggleTag(tag)}
                data-testid={`todo-edit-history-chip-${tag}`}
              >
                {tag}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

/** 优先级 chip 单选（新建/编辑共用，P0/P1/P2）。 */
const PRIORITY_OPTIONS: Array<{ p: MuseTodoPriority; label: string; color: string }> = [
  { p: "p0", label: "P0", color: "#e5484d" },
  { p: "p1", label: "P1", color: "#f76b15" },
  { p: "p2", label: "P2", color: "#868e96" },
];

const PriorityChips: React.FC<{
  value: MuseTodoPriority;
  onChange: (p: MuseTodoPriority) => void;
}> = ({ value, onChange }) => (
  <div className="todo-priority-chips">
    {PRIORITY_OPTIONS.map(({ p, label, color }) => (
      <button
        key={p}
        type="button"
        className={`todo-priority-chip${value === p ? " active" : ""}`}
        style={value === p ? { borderColor: color, color } : undefined}
        onClick={() => onChange(p)}
        aria-pressed={value === p}
        data-testid={`todo-priority-${p}`}
      >
        {label}
      </button>
    ))}
  </div>
);

/** 新建/编辑 TODO 共用弹窗（中等大小；Esc/点遮罩关闭）。 */
const TodoEditDialog: React.FC<{
  heading: string;
  submitText: string;
  /** testId 前缀：新建 todo-new-*，编辑 todo-edit-*。 */
  prefix: string;
  initial: {
    title: string;
    description: string;
    priority: MuseTodoPriority;
    tags: string[];
  };
  allTags: string[];
  onSubmit: (v: {
    title: string;
    description: string;
    priority: MuseTodoPriority;
    tags: string[];
  }) => Promise<boolean>;
  onClose: () => void;
}> = ({ heading, submitText, prefix, initial, allTags, onSubmit, onClose }) => {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [priority, setPriority] = useState<MuseTodoPriority>(initial.priority);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    const ok = await onSubmit({
      title: title.trim(),
      description,
      priority,
      tags,
    });
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <div className="todo-dialog-overlay" onClick={onClose} data-testid="todo-dialog">
      <div className="todo-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="todo-dialog-head">
          <span className="todo-dialog-title">{heading}</span>
          <button
            type="button"
            className="todo-icon-btn"
            onClick={onClose}
            aria-label="关闭"
            data-testid={`${prefix}-cancel`}
          >
            <i className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
        <div className="todo-dialog-body">
          <Text as="label" size="1" weight="medium" className="todo-dialog-field">
            标题
            <input
              className="todo-input"
              autoFocus
              placeholder="TODO 标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              data-testid={`${prefix}-title`}
            />
          </Text>
          <Text as="label" size="1" weight="medium" className="todo-dialog-field">
            描述（markdown）
            <TextArea
              size="1"
              placeholder="描述（markdown）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid={`${prefix}-desc`}
            />
          </Text>
          <div className="todo-dialog-field">
            <Text size="1" weight="medium">
              优先级
            </Text>
            <PriorityChips value={priority} onChange={setPriority} />
          </div>
          <div className="todo-dialog-field">
            <Text size="1" weight="medium">
              标签
            </Text>
            <TodoTagEditor tags={tags} allTags={allTags} onChange={setTags} />
          </div>
        </div>
        <div className="todo-dialog-actions">
          <Button size="1" variant="soft" onClick={onClose} data-testid={`${prefix}-cancel-btn`}>
            取消
          </Button>
          <Button
            size="1"
            onClick={() => void save()}
            disabled={!title.trim() || saving}
            data-testid={`${prefix}-save`}
          >
            {submitText}
          </Button>
        </div>
      </div>
    </div>
  );
};

export interface TodoBoardProps {
  api: MuseApiClient;
  /** 打开规划会话（懒创建后跳转到该会话）。 */
  onOpenPlanningSession?: (sessionId: string, workdir: string) => void;
  /** 打开 task 的执行会话（跳转到该会话；无会话时按钮禁用）。 */
  onOpenExecutionSession?: (sessionId: string) => void;
  /** 在编辑器中打开 task 的 workdir（worktree 时为其路径）。 */
  onOpenInEditor?: (workdir: string) => void;
  /** 在终端中打开 task 的 workdir（worktree 时为其路径）。 */
  onOpenInTerminal?: (workdir: string) => void;
  /** todo 状态变化（完成/取消）后触发——通知侧栏任务分组刷新。 */
  onTodosChanged?: () => void;
}

/**
 * 任务看板主视图（左右布局，spec 2026-08-21，原型定稿 A）。
 * 状态由 todoBoardStore（zustand）管理；组件只订阅与派发。
 */
export const TodoBoard: React.FC<TodoBoardProps> = ({
  api,
  onOpenPlanningSession,
  onOpenExecutionSession,
  onOpenInEditor,
  onOpenInTerminal,
  onTodosChanged,
}) => {
  const todos = useTodoBoardStore((s) => s.todos);
  const loading = useTodoBoardStore((s) => s.loading);
  const error = useTodoBoardStore((s) => s.error);
  const selectedId = useTodoBoardStore((s) => s.selectedTodoId);
  const selectTodo = useTodoBoardStore((s) => s.selectTodo);
  const openNewTodo = useTodoBoardStore((s) => s.openNewTodo);
  const closeNewTodo = useTodoBoardStore((s) => s.closeNewTodo);
  const newTodoOpen = useTodoBoardStore((s) => s.newTodoOpen);
  const cancelTodo = useTodoBoardStore((s) => s.cancelTodo);
  const completeTodo = useTodoBoardStore((s) => s.completeTodo);
  const createTodo = useTodoBoardStore((s) => s.createTodo);
  const updateTodo = useTodoBoardStore((s) => s.updateTodo);
  const selectTask = useTodoBoardStore((s) => s.selectTask);
  const init = useTodoBoardStore((s) => s.init);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  /** 搜索框：只匹配标题。 */
  const [search, setSearch] = useState("");
  /** 标签筛选：多选，任一命中（OR）。 */
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());

  /** 历史标签 = 当前列表所有 todo 的标签并集（编辑表单 + 筛选下拉共用）。 */
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of todos) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  }, [todos]);

  const toggleFilterTag = (tag: string) => {
    setFilterTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const visibleTodos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return todos.filter((t) => {
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (filterTags.size > 0 && !t.tags.some((tag) => filterTags.has(tag)))
        return false;
      return true;
    });
  }, [todos, search, filterTags]);

  React.useEffect(() => {
    init(api);
  }, [api, init]);

  /** 打开规划会话：懒创建（server 端）→ 回调跳转。 */
  const openPlanning = async (todoId: string) => {
    if (!onOpenPlanningSession) return;
    try {
      const { sessionId, workdir } = await api.openPlanningSession(todoId);
      onOpenPlanningSession(sessionId, workdir);
    } catch {
      // 打开失败静默（会话列表/刷新后仍可再点）
    }
  };

  /** 取消 todo：确认后级联取消未完成任务（执行中 task 由 onTurnSettled 兜底跳过）。 */
  const handleCancelTodo = async (todo: MuseTodo) => {
    if (!window.confirm(`确定取消 TODO「${todo.title}」？其未完成任务将一并取消。`)) {
      return;
    }
    await cancelTodo(todo.id);
    onTodosChanged?.();
  };

  /** 标记 todo 已完成：二次确认；服务端拦截（有任务未到终态）时提示。 */
  const handleCompleteTodo = async (todo: MuseTodo) => {
    if (!window.confirm(`确定将 TODO「${todo.title}」标记为已完成？`)) {
      return;
    }
    const ok = await completeTodo(todo.id);
    if (!ok) {
      window.alert(`TODO「${todo.title}」还有任务未完成（待执行/执行中/待审核），不能标记完成。`);
      return;
    }
    onTodosChanged?.();
  };

  const selected = useSelectedTodo();
  const tasks = useBoardTasks();
  const filterByTodo = useTodoBoardStore((s) => s.filterByTodo);
  const setFilterByTodo = useTodoBoardStore((s) => s.setFilterByTodo);

  return (
    <div className="todo-board">
      <div className="todo-board-left">
        <button
          type="button"
          className="todo-new-btn"
          onClick={openNewTodo}
          data-testid="todo-new-btn"
        >
          + 新建 TODO
        </button>
        {newTodoOpen && (
          <TodoEditDialog
            heading="新建 TODO"
            submitText="创建"
            prefix="todo-new"
            initial={{ title: "", description: "", priority: "p1", tags: [] }}
            allTags={allTags}
            onSubmit={async (v) => {
              const todo = await createTodo({ ...v, source: "manual" });
              if (todo) {
                selectTodo(todo.id);
                return true;
              }
              return false;
            }}
            onClose={closeNewTodo}
          />
        )}
        <div className="todo-toolbar">
          <input
            className="todo-input todo-search"
            placeholder="搜索标题…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="todo-search"
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className={`todo-tag-filter-btn${filterTags.size > 0 ? " active" : ""}`}
                data-testid="todo-tag-filter"
              >
                <i className="codicon codicon-tag" aria-hidden="true" />
                标签{filterTags.size > 0 ? ` (${filterTags.size})` : ""}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start">
              {allTags.length === 0 ? (
                <DropdownMenu.Label>暂无标签</DropdownMenu.Label>
              ) : (
                allTags.map((tag) => (
                  <DropdownMenu.CheckboxItem
                    key={tag}
                    checked={filterTags.has(tag)}
                    onCheckedChange={() => toggleFilterTag(tag)}
                    data-testid={`todo-tag-filter-option-${tag}`}
                  >
                    {tag}
                  </DropdownMenu.CheckboxItem>
                ))
              )}
              {filterTags.size > 0 && (
                <DropdownMenu.Item
                  onSelect={() => setFilterTags(new Set())}
                  data-testid="todo-tag-filter-clear"
                >
                  清除筛选
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        <ScrollArea className="todo-list-scroll">
          <Flex direction="column" gap="1">
            {visibleTodos.map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  className={`todo-row${t.id === selectedId ? " active" : ""}`}
                  onClick={() => selectTodo(t.id)}
                >
                  <div className="todo-row-line1">
                    <PriorityBadge p={t.priority} />
                    <span className="todo-row-title">{t.title}</span>
                    <IconBtn icon="comment-discussion" tip="打开规划会话（todo 专属会话）" testId={`todo-open-planning-${t.id}`} onClick={() => void openPlanning(t.id)} />
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          type="button"
                          className="todo-icon-btn todo-more-btn"
                          data-testid={`todo-more-${t.id}`}
                          aria-label="更多操作"
                        >
                          <i className="codicon codicon-more" aria-hidden="true" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content align="end">
                        {t.status === "pending" && (
                          <DropdownMenu.Item
                            onSelect={() => setEditingTodoId(t.id)}
                            data-testid={`todo-menu-edit-${t.id}`}
                          >
                            编辑 TODO
                          </DropdownMenu.Item>
                        )}
                        <DropdownMenu.Item
                          onSelect={() => void handleCompleteTodo(t)}
                          data-testid={`todo-menu-complete-${t.id}`}
                        >
                          标记完成
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => void handleCancelTodo(t)}
                          data-testid={`todo-menu-cancel-${t.id}`}
                        >
                          取消 TODO
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </div>
                  {t.description && (
                    <div className="todo-row-desc" title={t.description}>
                      {t.description}
                    </div>
                  )}
                  <div className="todo-row-line2">
                    <TodoStatusBadge status={t.status} />
                    <SourceTag source={t.source} />
                    {t.tags.length > 0 && (
                      <span className="todo-tag-chips">
                        {t.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className={`todo-tag-chip${filterTags.has(tag) ? " active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFilterTag(tag);
                            }}
                            data-testid={`todo-tag-chip-${tag}`}
                          >
                            {tag}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ),
            )}
            {visibleTodos.length === 0 && (
              <Text size="2" color="gray" className="todo-empty">
                无匹配的 TODO
              </Text>
            )}
          </Flex>
        </ScrollArea>
      </div>
      <div className="todo-board-right">
        <div className="todo-kanban-toolbar">
          <div className="todo-filter-toggle">
            <Switch
              size="1"
              checked={filterByTodo}
              onCheckedChange={setFilterByTodo}
              data-testid="todo-filter-by-todo"
            />
            <Text size="1" color="gray">
              {filterByTodo ? "仅「当前 TODO」" : "全部 TODO"}
            </Text>
          </div>
        </div>
        {loading ? (
          <Text size="2" color="gray" className="todo-empty">
            加载中…
          </Text>
        ) : error ? (
          <Text size="2" color="red" className="todo-empty">
            加载失败：{error}
          </Text>
        ) : !selected ? (
          <Text size="2" color="gray" className="todo-empty">
            暂无 TODO，点击「+ 新建 TODO」创建
          </Text>
        ) : tasks.length === 0 ? (
          <div className="todo-empty">
            <div className="todo-empty-icon">💬</div>
            {filterByTodo ? (
              <>
                <div className="todo-empty-title">这个 TODO 还没有任务</div>
                <div className="todo-empty-desc">打开规划会话，与 AI 分析拆解后创建 task</div>
                {onOpenPlanningSession && (
                  <Button size="2" onClick={() => void openPlanning(selected.id)} data-testid="todo-open-planning">
                    打开规划会话
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="todo-empty-title">还没有任何任务</div>
                <div className="todo-empty-desc">新建 TODO 后在规划会话里拆解出 task</div>
              </>
            )}
          </div>
        ) : (
          <ScrollArea className="todo-kanban-scroll">
            <Flex gap="3" align="start" className="todo-kanban-cols">
              {TASK_STATUS_ORDER.map((status) => {
                const col = tasks.filter((t) => t.status === status);
                return (
                  <div key={status} className="todo-kanban-col">
                    <div className="todo-kanban-col-head">
                      <TaskStatusBadge status={status} />
                      <Text size="1" color="gray">
                        {col.length}
                      </Text>
                    </div>
                    <Flex direction="column" gap="2" className="todo-kanban-col-body">
                      {col.map((task) => {
                        const todo = todos.find((t) => t.id === task.todoId);
                        return (
                          <Card key={task.id} size="1" className="todo-task-card" onClick={() => selectTask(task.id)}>
                            {!filterByTodo && todo && (
                              <Tooltip text={todo.title} position="top" wrap={false}>
                                <div className="todo-task-todo" title={todo.title} data-testid={`todo-task-todo-${task.id}`}>
                                  <i className="codicon codicon-list-unordered" aria-hidden="true" />
                                  <span className="todo-task-todo-title">{todo.title}</span>
                                </div>
                              </Tooltip>
                            )}
                            <Text size="2" weight="medium">
                              {task.title}
                            </Text>
                            {task.description && (
                              <div
                                className="todo-task-card-desc"
                                dangerouslySetInnerHTML={{
                                  __html: mdHtml(task.description),
                                }}
                              />
                            )}
                            <div className="todo-task-card-foot">
                              {task.worktreeName && (
                                <Text size="1" color="gray" className="todo-mono">
                                  {task.worktreeName}
                                </Text>
                              )}
                              <IconBtn
                                icon="comment-discussion"
                                tip={
                                  task.executionSessionId
                                    ? "打开执行会话"
                                    : "尚未执行，无会话"
                                }
                                disabled={!task.executionSessionId}
                                testId={`todo-open-exec-session-${task.id}`}
                                onClick={() => {
                                  if (task.executionSessionId)
                                    onOpenExecutionSession?.(task.executionSessionId);
                                }}
                              />
                            </div>
                          </Card>
                        );
                      })}
                    </Flex>
                  </div>
                );
              })}
            </Flex>
          </ScrollArea>
        )}
      </div>
      <TaskDrawer
        api={api}
        onOpenExecutionSession={onOpenExecutionSession}
        onOpenInEditor={onOpenInEditor}
        onOpenInTerminal={onOpenInTerminal}
        onTodosChanged={onTodosChanged}
      />
      {(() => {
        const editingTodo = todos.find((t) => t.id === editingTodoId);
        if (!editingTodo) return null;
        return (
          <TodoEditDialog
            heading="编辑 TODO"
            submitText="保存"
            prefix="todo-edit"
            initial={{
              title: editingTodo.title,
              description: editingTodo.description,
              priority: editingTodo.priority,
              tags: editingTodo.tags,
            }}
            allTags={allTags}
            onSubmit={async (v) => !!(await updateTodo(editingTodo.id, v))}
            onClose={() => setEditingTodoId(null)}
          />
        );
      })()}
    </div>
  );
};
