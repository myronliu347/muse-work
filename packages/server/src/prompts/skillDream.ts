import type { SkillDraft } from "../services/skillDream.js";

/**
 * Prompt for the assistant-only learning extractor (rules + skills).
 *
 * The extractor reads exported transcripts and returns JSON candidates. It
 * never writes files: the server validates and writes drafts, so the hidden
 * session needs no Write/Edit tool.
 */
export function buildSkillExtractorPrompt(input: {
  transcriptPaths: string[];
  existingSkills: Array<{ name: string; description: string; content: string }>;
  existingRules: Array<{ name: string; description: string; text: string }>;
  agentsMd: string;
  memoryIndex: string;
  observations: string;
  workdir: string;
  skillRoot: string;
  maxCandidates: number;
  ignored: Array<{ kind: "rule" | "skill"; name: string; description: string }>;
}): string {
  const skills = input.existingSkills.length
    ? input.existingSkills
        .map(
          (skill) =>
            `### ${skill.name}\n${skill.description}\n\n${skill.content.slice(0, 4000)}`,
        )
        .join("\n\n")
    : "（还没有助手私有技能。）";

  return [
    "你是助手的学习整理器。你只为这个助手沉淀它自己的工作方式，不服务 Issue 会话。",
    "",
    "## 助手是什么",
    "助手是长期在线的协调者：它和人对话，把要办的事派给 Issue 会话，处理 issue 结束、automation 结果、权限审批这些事件。",
    "助手不写代码、不跑构建、不改仓库，所以不要从 transcript 里提炼代码/项目相关的 SOP。",
    "",
    "## 你要找的两类东西",
    "",
    "### 1. 规则（rule）",
    "总是适用的行为指令，1–2 句，跨情境。例如汇报时机、默认路由、什么时候不打扰用户。",
    "不要找：多步骤流程（那是 skill）、事实/偏好（那是 memory）、项目规则、代码/构建规则、AGENTS.md 已经写过的内容。",
    "",
    "### 2. 技能（skill）",
    "只找“同一类助手工作”的多步骤 SOP：",
    "- 触发条件清楚（事件类型、用户说法、上下文）；",
    "- 有稳定的步骤、判断分支、工具调用顺序；",
    "- 有这类事常踩的坑；",
    "- 有验收方式。",
    "",
    "不要找：",
    "- 一句话规则/偏好（那属于 AGENTS.md 或 memory）；",
    "- 项目知识、代码命令、构建/测试/调试步骤；",
    "- 一次性的任务叙事；",
    "- 没有实际执行成功过的做法；",
    "- 与现有技能重复的内容；优先 update 现有技能，而不是新建；",
    "- 与 AGENTS.md 或系统提示冲突的内容。",
    "",
    "## 先匹配，再决定 action",
    "输出前必须和现有规则/技能逐条对比：",
    "1. 现有规则里已有同一条规则（同触发、同含义）→ action=update，用现有 name，把 text 改成合并后的版本，不要新建。",
    "2. 现有技能里已有同一类（同触发、覆盖同一组步骤）→ action=update，用现有 name，保留原有仍然正确的步骤和坑，只改需要改的部分。",
    "3. 只是参数不同（时间范围、项目、分组）→ action=update，不要新建。",
    "4. 确实没有同类 → action=create。",
    "不要给同一类起第二个近义 name；同名或近义必须复用现有 name。",
    "",
    "## 判断“同一类”",
    "- 按工作意图判断，不按字面措辞；",
    "- 差异是参数（时间范围、项目、分组方式）→ 写进 SOP 的参数说明；",
    "- 差异是分支 → 写进判断条件；",
    "- 差异是特例 → 写进坑；",
    "- 优先沉淀不同天出现 2 次以上、或用户明确说“以后都这样”的类。",
    "",
    "## 覆盖检查",
    "- 先按工作意图给本批 transcript 分桶，再对每个桶判断是规则还是技能。",
    "- 每份 transcript 都要看一眼；不要只总结最近、最长或最显眼的一份。",
    "- 只出现 1 次的类也输出候选（occurrenceDays=1），由人筛；宁可多提一条，也不要把一整类漏掉。",
    "- 但步骤必须具体到触发、操作、坑、验收；空泛的“先分析再处理”不要提。",
    "",
    "## 现有助手技能",
    skills,
    "",
    "## 现有助手规则（不能重复或冲突）",
    input.existingRules.length
      ? input.existingRules
          .map((rule) => `- ${rule.name}: ${rule.text}`)
          .join("\n")
      : "（还没有自动提取的规则。）",
    "",
    "## 用户已忽略（不要再提）",
    "以下内容用户明确忽略过；不要再次输出，也不要换近义 name 或改写后重提。",
    input.ignored.length
      ? input.ignored
          .map(
            (entry) =>
              `- [${entry.kind}] ${entry.name} — ${entry.description}`,
          )
          .join("\n")
      : "（没有。）",
    "",
    "## AGENTS.md（人手写的规则，不能重复或冲突）",
    input.agentsMd || "（空）",
    "",
    "## 记忆索引（只用来避免重复，不要把记忆写成技能）",
    input.memoryIndex || "（空）",
    "",
    "## 最近的学习观察（跨 run 的 intent 记录）",
    input.observations || "（空）",
    "",
    "## 本次 transcript",
    ...input.transcriptPaths.map((file) => `- ${file}`),
    "",
    "## 输出",
    "只输出一个 JSON 对象，不要输出解释、不要用 Markdown 代码块以外的文字：",
    "```json",
    JSON.stringify(
      {
        rules: [
          {
            action: "create",
            name: "report-timing",
            intent: "report_timing",
            description: "只在失败、卡住或需要用户拍板时主动发消息。",
            text: "只有失败、卡住或需要用户拍板时才主动发消息；正常完成静默更新，不逐条播报。",
            evidence: [{ day: "2026-11-20", quote: "以后别每件都汇报" }],
            occurrenceDays: 2,
            explicit: false,
            confidence: 0.8,
          },
        ],
        candidates: [
          {
            action: "create",
            name: "progress-review",
            intent: "progress_review",
            description:
              "当用户要求汇总/回顾一段时间的事项进展，或周一例行检查时使用。",
            content:
              "---\nname: progress-review\ndescription: 当用户要求汇总/回顾一段时间的事项进展时使用。\n---\n\n## 触发\n...\n\n## 步骤\n1. ...\n\n## 坑\n- ...\n\n## 验收\n...",
            evidence: [{ day: "2026-11-17", quote: "用户要求汇总上周进展" }],
            occurrenceDays: 2,
            explicit: false,
            confidence: 0.8,
          },
        ],
      },
      null,
      2,
    ),
    "```",
    "",
    "occurrenceDays 填这类事在 observations + 本次 transcript 里出现过的不同天数。",
    "只出现 1 天的类也请输出候选，并把 occurrenceDays 设为 1；系统会生成带“首次出现”标记的草稿，批量采纳会跳过它，人可以逐条确认。",
    "如果用户明确说“以后都这样/记住”，把 explicit 设为 true 并给出用户原话作为证据。",
    "规则同样适用；update 必须复用现有 name；规则 text 要能独立成立，不要写事故叙事、命令、路径或密钥。",
    `rules 和 candidates 各最多 ${input.maxCandidates} 条；没有合格的就输出空数组。`,
    `技能会写到 ${input.skillRoot}；每条的 content 必须是完整的 SKILL.md，frontmatter 必须包含 name 和 description，name 与 candidate.name 一致。`,
    `助手 workdir：${input.workdir}`,
  ].join("\n");
}

export function buildSkillExtractorTask(transcriptPaths: string[]): string {
  return [
    "读取上面列出的 transcript（逐个读完，可以分页），结合现有技能、规则、AGENTS.md、memory 索引和 observations，",
    "找出值得沉淀为助手规则或 SOP 的“同一类工作”。逐个读完，不要只读最近一份；",
    "为 rules 和 candidates 分别判断；两类都没有就都输出空数组。只输出 JSON。",
  ].join("\n");
}

export function summarizeSkillDrafts(drafts: SkillDraft[]): Array<{
  name: string;
  description: string;
  action: "create" | "update";
  confidence: number;
}> {
  return drafts.map((draft) => ({
    name: draft.name,
    description: draft.description,
    action: draft.action,
    confidence: draft.confidence,
  }));
}
