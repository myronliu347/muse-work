# Muse Work — Issue

用户以 Issue 记录一件要做成的事。可从 UI、普通会话或 POPO 创建。打开会话时选定工作目录和工作模式（选定后不可改）。默认是单 agent：本会话确认需求并改代码。也可以选规划 + 执行：规划会话禁改源码，再 dispatch 到同一个执行会话。关单发生在 UI，或规划/单 agent/POPO 对话里用 skill。

## Language

**Issue**:
用户登记的一件事。带标题、markdown 描述、优先级 p0/p1/p2（默认 p1）、标签。状态见下。每 Issue 最多一个工作/规划会话；规划 + 执行模式下再固定一个执行会话。结构化任务清单挂在 Issue 上，不是独立可调度实体。侧栏暂不展示清单正文。
_Avoid_: Todo、Task 实体、需求单

**工作模式（agentMode）**:
首次打开会话时选择，写入后不可改。`single`：会话场景 agent（默认 `default`），规划与实现都在本会话；挂 issue 插件只为关单（complete/cancel），不建清单、不 dispatch；不进入执行中/待审核。`split`：规划会话 + 执行会话，清单与 dispatch 走 issue skill。
_Avoid_: 打开后再改模式、给单 agent 接状态机

**任务清单（Checklist）**:
Issue 上的结构化条目：`id`、`content`、`pending | running | done`。对人暂不可见。普通会话和 POPO 可以给 pending Issue 追加清单。规划 AI（仅 split）只能追加或删除尚未执行的项，不能整表覆盖已执行项。执行 AI 按条目干活；全部 `done` 后 Issue 进入待审核。
_Avoid_: 子任务实体、看板列、侧栏勾选清单

**打开会话**:
从 Issue 懒创建、绑定 workdir / worktree / 工作模式。每个 Issue 固定一次。UI 文案用「打开会话」，不再叫「打开规划会话」。
_Avoid_: 分析会话

**规划会话（Planning session）**:
仅 `split`。用于多轮确认需求与技术方案。可读代码做分析、可写文档；禁止在本会话改源码，改代码必须 dispatch 到执行会话。
_Avoid_: 把单 agent 工作会话叫规划会话并禁写源码

**工作会话（单 agent）**:
`single` 模式下打开的那条会话。确认需求后直接改代码；系统拒绝 dispatch；不维护清单。仍挂 issue skill，用户明确说完成/取消时 `complete` / `cancel`。
_Avoid_: 单 agent 用清单调度、dispatch

**执行会话（Execution session）**:
仅 `split`。规划 AI 调度来改代码的会话。每个 Issue 固定一个，配置继承规划会话；审核阶段仍可往同一会话 `dispatch`。
_Avoid_: 每个清单项一个会话

**Dispatch**:
规划会话调用工具，向该 Issue 的执行会话投入一轮工作（指定清单项 + 提示）。执行回合结束后系统把结果回写规划会话：一条 `system-inject` 短信封，正文以 `来源：执行会话` 开头（哪一项、结束/中断/失败、未完成清单、**执行结论**；有改动则附文件路径）。规划须对照清单审核产物：产物不一定是文件，也可能是结论里的表格或分析。完整工具过程按需用 `exec-turn` 读取，不强制。规划达标须先把该项标为 done 再派下一项；中断/失败只重派同一项。执行回合结束**不会**自动把该项标为 done。未标 done 时系统拒绝派下一项。执行中若规划回合结束仍未再派：中断则系统重派同一项；成功仍有未完成项则再催规划（不替规划选下一项）。同时更新清单项状态。单 agent 调用 dispatch 返回 409。
_Avoid_: 子代理冒充执行会话

**待审核**:
仅 `split`。清单全部 `done` 后的状态。人与规划 AI 继续对话；可选 E2E / code review 子代理；仍可 dispatch。没有「审核不通过」「审核中」。只有完成或取消能离开此状态（完成前若又 dispatch，状态仍待审核）。
_Avoid_: 审核失败、打回规划中、单 agent 进待审核

## 状态

待规划 → 打开会话后为规划中。

`split`：规划中 → 执行中（创建/唤醒执行会话并开始 dispatch）→ 待审核（清单全部 done）→ 已完成。任意未完成可取消。

`single`：打开后保持规划中，直到完成或取消；不因清单或 dispatch 进入执行中/待审核。

已完成、已取消写入独立索引 `issues-closed.json`，不出现在侧栏。
