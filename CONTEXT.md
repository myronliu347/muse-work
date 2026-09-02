# Muse Work — Issue

用户以 Issue 记录一件要做成的事。先开规划会话确认需求与方案、落下任务清单，再由规划 AI 调度同一个执行会话做完清单，人在待审核阶段与规划 AI 对话直到关闭。

## Language

**Issue**:
用户登记的一件事。带标题、markdown 描述、优先级 p0/p1/p2（默认 p1）、标签。状态见下。每 Issue 最多一个规划会话、一个执行会话；结构化任务清单挂在 Issue 上，不是独立可调度实体。
_Avoid_: Todo、Task 实体、需求单

**任务清单（Checklist）**:
Issue 上的结构化条目：`id`、`content`、`pending | running | done`。规划 AI 用工具增删改；执行 AI 按条目干活；全部 `done` 后 Issue 进入待审核。
_Avoid_: 子任务实体、看板列

**规划会话（Planning session）**:
从 Issue 懒创建、用于多轮确认需求与技术方案的会话。创建时必选 workdir，以及是否 worktree 模式。每个 Issue 固定一个。可读代码做分析、可写文档；禁止在本会话改源码，改代码必须 dispatch 到执行会话。
_Avoid_: 分析会话、Issue 会话

**执行会话（Execution session）**:
规划 AI 调度来改代码的会话。每个 Issue 固定一个，配置（workdir、是否 worktree、base 分支等）继承规划会话；审核阶段仍可往同一会话 `dispatch`。
_Avoid_: 每个清单项一个会话

**Dispatch**:
规划会话调用工具，向该 Issue 的执行会话投入一轮工作（指定清单项 + 提示）。执行回合结束后系统把结果回写规划会话：一条 `system-inject` 消息，正文必须以 `来源：执行会话` 开头，并附带本回合**执行过程**（工具、改动文件、子代理输出）和执行结论。规划 AI 根据过程判断下一发：达标才派下一项；中断/失败只重派同一项。同时更新清单项状态。
_Avoid_: 子代理冒充执行会话

**待审核**:
清单全部 `done` 后的状态。人与规划 AI 继续对话；可选 E2E / code review 子代理；仍可 dispatch。没有「审核不通过」「审核中」。只有完成或取消能离开此状态（完成前若又 dispatch，状态仍待审核）。
_Avoid_: 审核失败、打回规划中

## 状态

待规划 → 规划中（创建规划会话）→ 执行中（创建/唤醒执行会话并开始 dispatch）→ 待审核（清单全部 done）→ 已完成。任意未完成可取消。

已完成、已取消不出现在侧栏「待办事项」，数据保留。
