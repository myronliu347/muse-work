# 助手学习整理 — 设计说明

日期：2026-11-24  
状态：Phase 1 / Phase 2 已实现，Phase 3 部分实现  
范围：助手（`origin=assistant`）的学习整理 run；记忆 / 规则 / 技能三类草稿；检查页与替换流程

## 0. 实现状态

已落地（Phase 1）：

- `skillDream.ts`：transcript 游标（新增/追加/重写）、技能候选解析、草稿写入、lint、adopt；
- `memoryDreamEngine.ts`：assistant target 的 skill pass，一次 extractor，只读工具；
- `prompts/skillDream.ts`：技能提取 prompt；
- `/memory-dream/runs/:id/skills/:name/adopt` 与报告里的 `skills`；
- `MemoryDreamSettings` 的技能草稿检查与采纳；
- 跨 run 的 `observations.jsonl` 写入，作为下一次提取的输入。

Phase 2 已落地：

- `ruleDream.ts`：规则候选解析、草稿、lint、adopt；
- extractor 同一次输出 `rules` + `candidates`；
- 规则写到 `.muse-work/rules/auto-<name>.md`；
- 检查页增加规则块，采纳前做 AGENTS.md 重复/密钥/长度校验；
- 规则采纳提示“下次会话生效”。

Phase 3 已落地：

- 检查页的“忽略”：把候选内容 hash 写入 `~/.muse-work/assistant/learning/suppressed.json`，下次不再起草同样的规则/技能；
- “采纳全部安全项”：一次采纳所有 lint 通过且未采纳的规则/技能（记忆仍需单独替换）；
- 规则采纳后，助手空闲时释放 live agent，下一轮重建即可加载；运行中则下次会话生效。

未做（Phase 3）：

- episode 采集（当前 recurrence 主要靠 observations + 本次 transcript）；
- 检查页的逐项勾选与统一“应用选中变更”（当前是逐条采纳 + “采纳全部安全项”）；
- 规则与系统提示的更强冲突检查；
- 自动采纳。

## 1. 问题

助手是长期在线的协调者，它的工作方式和其他 AI 不一样：主要做沟通、路由和事件处理，不直接改代码。现在这些行为经验只能靠人手写：

- 系统提示里写死的通用规则；
- `AGENTS.md` 里写的项目/用户规则；
- 技能市场安装的技能。

助手自己不会从跨会话的经历里总结“这个用户希望怎么被汇报”“这类事情应该先查再派”。现有 `memory dream` 只整理记忆，不产出规则和技能；而如果每次整理都全量重读所有 transcript，成本又太高。

目标是在**同一次整理 run** 里，增量地产出三类草稿，给人在一个页面上检查，确认后替换。

## 2. 目标与非目标

**目标**

- 一次整理 run 同时处理：记忆整理、规则提取、技能提取/更新。
- 只服务助手；Issue 会话不可见。
- 只处理新增和变更过的 transcript，不重复读历史。
- 所有产出先落草稿；人在检查页确认后替换；有备份和回滚。
- 技能是 class-level SOP：触发、步骤、坑、验收；不是一次性总结。

**非目标**

- 不做通用技能市场，不做跨助手共享技能库。
- 不自动重写 `AGENTS.md`。规则优先生成到 `.muse-work/rules/auto-*.md`；要进 `AGENTS.md` 只改带标记的自动区块。
- 不从项目/代码知识里抽助手技能（那些属于 Issue 会话或项目 memory）。
- 第一阶段不做自动发布；自动采纳只作为后续低风险选项。
- 不改 Issue 会话的工具和技能可见性。

## 3. 概念与边界

| 产出 | 定义 | 例子 | 加载 |
|---|---|---|---|
| memory | 事实、偏好，陈述句 | 用户是后端，偏好 pnpm | 每轮索引 |
| rule | 总是适用的行为指令，1–2 句 | 只有失败或需要拍板时才主动发消息 | 每轮 |
| skill | 同一类问题的多步骤 SOP | 周一进展汇总的固定流程 | 按描述触发 |

判定顺序：

1. 系统提示已经写过的通用规则 → 不写。
2. 一句话、跨情境都适用 → rule。
3. 事实、偏好、环境信息 → memory。
4. 多步骤、只在特定情境触发 → skill。
5. 项目/代码知识、一次性事件、未验证的失败 → 丢弃。

**一条经验只放一处。** 同一个意思出现在 rule 和 skill 里，后续一定冲突。

技能的结构固定为：

```markdown
---
name: progress-review
description: 当用户要求汇总/回顾一段时间的事项进展，或周一例行检查时使用。
---

## 触发
...

## 步骤
1. ...
2. ...

## 坑
- ...

## 验收
...
```

## 4. 存储与隔离

```
~/assistant-chat/
  AGENTS.md                       # 人手写的规则
  .muse-work/rules/               # 自动提取的规则，逐条文件
    auto-report-timing.md
  .muse-work/skills/              # 自动沉淀的 SOP
    progress-review/
      SKILL.md

~/.muse-work/projects/<encoded>/memory/   # 现有 auto-memory
~/.muse-work/dreams/drafts/<target>/<runId>/
  memory/
  rules/
  skills/
  transcripts/
  changes.json
~/.muse-work/assistant/learning/
  cursors.json
  observations.jsonl
```

为什么这样可以隔离：

- `SkillManager` 的项目级扫描是 `<workdir>/.muse-work/skills`、`.claude/skills`、`.agents/skills`；
- 助手 workdir 固定在 `~/assistant-chat`，Issue 会话的 workdir 是各自项目目录；
- 所以只有助手这条会话能扫到 `.muse-work/skills` 和 `.muse-work/rules`；
- 目录在 home 下，不在 git 仓库里，不会脏工作区。

注意：

- 这是 catalog 隔离，不是文件保密。其他会话如果有 `Read`/`Bash`，知道路径仍能读。
- 项目级 skill 会覆盖同名 personal/市场 skill；自动技能加前缀或建前查重。
- 助手 workdir 不能变；如果以后允许改，需要加显式的 assistant-only skill root。

## 5. 触发与检测

### 5.1 每轮只记录

助手每轮结束写一条 episode，不调用 LLM：

```json
{
  "id": "ep-...",
  "at": 1760000000000,
  "sessionId": "...",
  "turnId": "...",
  "eventTypes": ["chat"],
  "userText": "以后汇总只列需要我拍板的",
  "assistantMessages": ["..."],
  "toolCalls": [
    {"name": "ListIssues", "args": {}, "ok": true, "resultSummary": "12 条"}
  ],
  "nextUserText": null,
  "outcome": "unknown"
}
```

- 从 `runner.getMessages()` 取本轮消息，按 turn 起点切片；
- 工具结果只留 200–300 字摘要；
- 下一轮用户消息到达时，回填上一条的 `nextUserText` 和 `outcome`；
- 存 `~/.muse-work/assistant/learning/episodes/YYYY-MM.jsonl`。

### 5.2 什么时候写 skill / rule

| 时机 | 动作 |
|---|---|
| 每轮结束 | 只记 episode，不写 |
| 同一类事第二次出现（跨天） | 生成草稿，可直接采纳 |
| 同一类事只出现一次 | 生成草稿并标记“首次出现”；批量采纳跳过，逐条采纳会提示建议再观察 |
| 用户明确说“以后都这样/记住这个” | 当场生成草稿 |
| 已有 skill 被纠正 | patch 那一条 |
| 一次性任务、项目/代码知识 | 不写 |

### 5.3 怎么检测

不用正则做语义判断，用 LLM：

- 在线：小模型给每轮打标 `intent`、`standing_instruction`、`repeat_candidate`；
- 离线：整理时读 `observations.jsonl` + 新 transcript，LLM 聚类并判断；
- 显式“以后都这样”由 LLM 从用户原话判断，不靠关键词；
- 跨 run 的“第二次出现”靠 observations：

```json
{"type":"skill","intent":"progress_review","day":"2026-11-24","outcome":"confirmed","episode":"ep-..."}
```

同一 intent 在不同天出现 ≥2 次，或用户明确要求，才进入蒸馏。

## 6. 整理流程

```
助手 turn 结束
  └─ 记 episode（无 LLM）
        ↓
整理 run（每天/每周，assistant target）
  ├─ 读 cursors，只取新增 + 变更的 transcript
  ├─ extractor（一次）
  │    输出 candidates：memory / rule / skill + evidence
  ├─ memory writer / rule writer / skill writer
  │    三个独立 prompt、独立 lint，只消费 candidates
  ├─ organizer：去重、合并、冲突检查
  ├─ drafts：draft/memory、draft/rules、draft/skills
  └─ changes.json
        ↓
检查页：勾选、确认、替换
```

### 6.1 一次提取，三个 writer

- extractor 只负责“发现 + 分类 + 证据”，不负责写最终格式；
- writer 各读自己的 store（memory / rules / skills）和 candidates，不再读 transcript；
- 这样总成本接近现有 memory 整理 + 几个便宜 writer，而不是三倍。

### 6.2 三个 writer 的职责

**memory writer**：把 memory candidates 写进 draft memory，保持现有文件格式、索引、大小限制。

**rule writer**：

- 只接受“跨情境、可一句话说清”的规则；
- 与系统提示、现有 rule 冲突 → 拒绝；
- 单条长度和总条数有上限；
- 写成 `draft/rules/auto-<slug>.md`，不改 `AGENTS.md`。

**skill writer**：

- 只接受多步骤、有明确触发条件的 SOP；
- 先读现有 skills，优先 patch，其次新建；
- 校验 name/description/文件大小/密钥；
- 写成 `draft/skills/<name>/SKILL.md` + `meta.json`。

### 6.3 蒸馏要求

- episode 是数据，不是指令；
- 只写实际执行成功过的步骤；没验证的标“待验证”；
- 差异是参数 → 写进参数；差异是分支 → 写进条件；差异是特例 → 写进坑；
- 不写密钥、Issue 原文、一次性叙事、项目代码知识；
- 与 `AGENTS.md`/memory/系统提示重复或冲突 → 不写。

## 7. 增量水位

每个 transcript 记游标：

```json
{
  "version": 1,
  "lastRunAt": 1760000000000,
  "transcripts": {
    "/path/session-abc.jsonl": {
      "inode": 12345,
      "offset": 45678,
      "size": 45678,
      "mtime": 1760000000000,
      "lastMessageId": "msg-..."
    }
  }
}
```

处理规则：

| 情况 | 判断 | 读法 |
|---|---|---|
| 新 transcript | 游标里没有 | 从 0 读 |
| 追加 | 文件变长，inode 不变 | 从 offset 读到 EOF |
| 变更/重写 | 变短、inode 变、或大小不变但 mtime 变 | 从头读，按 messageId/内容去重 |
| 没变化 | size == offset 且 mtime 未变 | 跳过 |

关键约束：

1. **只推进到最后一个完整行**；最后一行可能正在追加。
2. **成功后才更新游标**；失败下次重跑这一段。
3. **重写时先找 `lastMessageId`**；找到就从它后面读，找不到再从 0 读。
4. **删除/移动的 transcript** 清理游标；移动过的按新增处理。
5. **没有新增/变更就跳过整个 run**，不启动 LLM。

## 8. 检查页

在现有 `MemoryDreamSettings` 页面里扩展，一个 run 一个页面，三块内容。

```
整理结果 · 11-24 03:12        [全部采纳安全项]  [全部忽略]

概览：记忆 3 个文件 · 规则 2 条 · 技能 1 个 · 冲突 1

▼ 记忆（整组替换）
  [x] MEMORY.md              +2 -1   查看 diff
  [x] feedback_reports.md    新增     查看
  证据：11-17、11-24 的对话
  说明：记忆按整组替换，不能只选单个文件

▼ 规则（逐条）
  [x] 汇报时机（新增）  “只有失败或需要拍板时才主动发消息”
      证据：11-20 用户说“以后别每件都汇报”
      影响：每轮 +18 字   冲突：无

▼ 技能（逐个）
  [x] progress-review（新增）
      触发：用户要求汇总/回顾进展
      证据：11-17、11-24 两次
      参数：时间范围、项目、分组方式
      冲突：与规则“汇报时机”有重叠 → 建议删掉技能里的重复步骤

底部：将替换 3 个记忆文件、新增 1 条规则、新增 1 个技能
[确认替换]   [取消]
```

### 8.1 每块展示什么

**记忆**：文件级新增/修改/删除、diff、证据；整组勾选。因为 `MEMORY.md` 是索引，MVP 不支持只选单个文件。

**规则**：规则原文、触发场景、出现天数、证据、每轮 token 影响、与现有规则/系统提示的冲突。默认不勾选（always-on，风险最高）。

**技能**：name、description（触发条件）、SOP 预览、证据 episode、参数、与现有技能/规则的重复；支持“合并到已有技能”。

### 8.2 替换语义

- **记忆**：整个 draft memory 目录替换 live；先备份，再 lint；失败整组不生效。
- **规则**：逐条写 `rules/auto-<slug>.md`；更新替换该文件；每条独立。
- **技能**：逐个目录替换 `skills/<name>/`；更新先备份旧版本；每个独立。
- 底部按钮只在至少选中一项时可用；替换前确认，写清影响和备份位置。

### 8.3 替换后生效

- 记忆：下一轮读取，清 `MemoryService` 缓存。
- 技能：刷新 skill catalog，下一轮 `Skill` 工具可见。
- 规则：`MemoryRuleManager` 只在 agent 初始化时 `discoverRules()`；替换后需要重建助手 agent，或明确提示“下次会话生效”。

### 8.4 冲突、忽略、回滚

- 规则与系统提示冲突 → 阻止替换。
- 规则与技能重复 → 警告，建议只留一处。
- 记忆与规则矛盾 → 标红，让人决定。
- 用户忽略的条目按内容 hash 存入 suppressed，下次不再重复提；有新证据才可再提。
- 每次替换备份；支持整次回滚和单条回滚。

## 9. 数据模型与接口

### 9.1 changes.json

```ts
type LearningChange = {
  id: string;
  kind: "memory" | "rule" | "skill";
  action: "create" | "update" | "delete" | "archive";
  target: string;
  title: string;
  before?: string;
  after?: string;
  diff?: string;
  evidence: Array<{ day: string; quote?: string; episodeId?: string }>;
  occurrenceDays: number;
  lint: { ok: boolean; issues: string[] };
  conflicts: Array<{ kind: string; target: string; message: string }>;
  tokenImpact?: number;
  status: "pending" | "applied" | "rejected";
};
```

### 9.2 接口

```
GET  /memory-dream/runs/:id/changes
POST /memory-dream/runs/:id/apply
     { "memory": true, "ruleIds": ["..."], "skillIds": ["..."] }
POST /memory-dream/runs/:id/reject
     { "ids": ["..."], "reason": "..." }
POST /memory-dream/runs/:id/rollback
     { "changeId": "..." }   // 省略则回滚整次
```

现有 `POST /memory-dream/runs/:id/adopt` 保留，等价于“采纳全部安全项”。

### 9.3 对现有类型的扩展

`MemoryDreamReport` 增加：

```ts
rules: LearningChange[];
skills: LearningChange[];
conflicts: Array<{ ... }>;
```

`DreamRunResult` 增加 `rules`、`skills` 摘要；`DreamRun` 增加 `appliedAt`、`appliedChanges`。

## 10. 代码落点

- `packages/server/src/services/memoryDreamEngine.ts`
  - `exportTranscripts` 改为按 offset 增量读；
  - 在 memory organizer 后增加 extractor、rule writer、skill writer；
  - 增加每次 run 的预算和 deferred 列表。
- `packages/server/src/prompts/memoryDream.ts`
  - 新增 extractor / rule writer / skill writer 的 prompt；
  - 不复用 memory analyzer 的 prompt。
- `packages/server/src/services/memoryDreamLint.ts`
  - 增加 `lintRuleDraft`、`lintSkillDraft`。
- `packages/server/src/services/memoryDreamAdopt.ts`
  - 增加 `adoptRuleDraft`、`adoptSkillDraft`；保持 memory 整组替换。
- `packages/server/src/services/memoryDreamGate.ts`
  - assistant target 增加“有新 episode/transcript”条件。
- `packages/server/src/services/memoryDreams.ts`
  - 保存 cursors / observations 路径，扩展 run 记录。
- `packages/webview/src/components/settings/MemoryDreamSettings.tsx`
  - 三块内容、逐项勾选、diff、冲突、替换/回滚。
- `packages/agent/src/managers/skillManager.ts`
  - MVP 用助手 workdir 的项目技能目录；后续可加 assistant-only root。
- `packages/server/src/routes/memoryDream.ts`
  - 新增 changes / apply / reject / rollback 路由。

## 11. 迭代闭环

- `Skill` 被调用时记录 `skill_used`（skill 名、session、turn、issue）。
- 下一轮用户纠正 → 该 skill 标 `needs_review`。
- 下次整理的 skill writer 优先 patch 它。
- 90 天未使用 → archive；用户 pin 的保留。
- 冲突优先级：**system prompt > rules/AGENTS.md > skill**；技能正文写明“冲突时以系统提示/规则为准”。

## 12. 成本控制

- 一次 extractor 读 transcript，三个 writer 只消费 candidates。
- 每次 run 限制：

```
maxNewTranscripts: 3
maxTranscriptBytes: 2MB
maxCandidatesPerKind: 3
maxModelCalls: 8
maxRunMinutes: 30
```

- 超预算先处理最新的，其余标 `deferred`，下次优先。
- 全量重排只在首次、迁移、手动“深度整理”、每月一次。

## 13. 分阶段

### Phase 1：增量采集 + 技能草稿

- episode 采集、cursor、observations 只写不判；
- extractor 只产出 skill 候选；
- skill writer + 草稿目录 + 检查页技能块；
- memory 仍走现有 analyzer。
- 验收：第一次出现也出草稿并标“首次”；第二次/显式要求可批量采纳；助手能看到、Issue 会话看不到。

### Phase 2：规则草稿 + 三块检查页

- rule writer、rules/auto-*.md、规则块；
- 冲突检查、默认不勾选；
- 检查页支持三块分别 adopt/reject；
- 验收：规则不影响系统提示；冲突阻止替换；替换后可回滚。

### Phase 3：迭代与归档

- skill_used、纠正回流、needs_review；
- 90 天归档、pin；
- 跨 run 的 observations 判断“第二次”。
- 验收：被纠正的 skill 能在下一次整理被 patch；无人用的能归档。

### Phase 4：低风险自动采纳

- 只对 patch 自动创建的已有 skill；
- lint 通过、无冲突、diff 小；
- 连续 N 次人工采纳后再开。

## 14. 风险与未决问题

**风险**

- 自动规则与助手长 system prompt 冲突 → 只出草稿、冲突检查、默认不勾选。
- 一次情绪被固化 → 要求跨天重复或明确“以后”。
- 助手技能变成项目笔记 → extractor 明确丢弃项目/代码知识。
- 隔离泄漏 → 私有目录 + 测试。
- 技能膨胀 → 20 条上限、class-level、90 天归档。
- 重写 transcript 导致重复提取 → messageId/内容 hash 去重。

**未决问题**

1. Phase 1 是否保留现有 memory analyzer，还是直接用 extractor 取代它？建议先保留，降低记忆质量回退风险；Phase 3 再合并。
2. 规则最终进 `.muse-work/rules/` 还是 `AGENTS.md` 的自动区块？建议 rules 目录，`AGENTS.md` 留给手写。
3. 助手 workdir 未来是否可变？如果可变，需要显式 assistant-only skill root。
4. DSH 版怎么做？DSH 的技能是会话共享的，需要私有 skill 工具/目录，等小盏页落地后再定。

## 15. 验收清单

- [ ] 没有新增/变更 transcript 时，整理 run 不调用 LLM。
- [ ] 只处理 offset 之后的新内容；重写文件不会重复产出候选。
- [ ] 第一次出现也生成带“首次”标记的草稿；批量采纳跳过它，逐条采纳有提示。
- [ ] 用户明确说“以后都这样”能出草稿。
- [ ] 记忆整组替换；规则/技能逐条替换。
- [ ] 检查页能看 diff、证据、冲突、token 影响。
- [ ] 规则与系统提示冲突时不能替换。
- [ ] 替换前备份；支持整次/单条回滚。
- [ ] 助手技能只在助手会话可见；Issue 会话不可见。
- [ ] 替换后明确说明生效方式；规则在下次会话或重建 agent 后生效。
