// Muse issue tools, mounted inside the muse-lead preset only.
//
// Registered with plain tool definitions: a third-party bundle cannot import
// `defineTool`, but the registry accepts the same shape.
export const inject = ['muse', 'tools'];

const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
};

function describe(issue) {
  return [
    `${issue.id} [${issue.status}/${issue.priority}] ${issue.title}`,
    issue.workdir ? `  workdir: ${issue.workdir}` : '',
    issue.sessionId ? `  session: ${issue.sessionId}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function apply(ctx) {
  const muse = ctx.muse;

  const tools = [
    {
      name: 'CreateIssue',
      description:
        '登记一件事。只创建记录，不建会话；派活要用 MessageIssue。返回事项 id。',
      parameters: {
        title: { type: 'string', required: true, description: '一句话说清要办成什么。' },
        description: {
          type: 'string',
          required: true,
          description: '目标、边界、产物、怎么验收。Markdown。',
        },
        priority: {
          type: 'string',
          enum: ['p0', 'p1', 'p2'],
          description: '默认 p1。',
        },
        workdir: {
          type: 'string',
          description: '这件事的工作目录，绝对路径。不填用插件默认目录。',
        },
      },
      output: textOutput,
      async execute(args) {
        const issue = await muse.createIssue(args);
        return `已创建 ${describe(issue)}`;
      },
    },
    {
      name: 'ListIssues',
      description: '列出进行中的事项（已完成和已取消的不在列表里）。',
      parameters: {},
      output: textOutput,
      async execute() {
        const issues = muse.listIssues().filter(
          (issue) => issue.status !== 'completed' && issue.status !== 'cancelled',
        );
        if (issues.length === 0) return '没有进行中的事项。';
        return issues.map(describe).join('\n');
      },
    },
    {
      name: 'GetIssue',
      description: '读一件事的完整记录：描述、状态、会话 id、关闭说明。',
      parameters: {
        issueId: { type: 'string', required: true },
      },
      output: textOutput,
      async execute(args) {
        const issue = muse.getIssue(args.issueId);
        if (!issue) return `没有这个事项：${args.issueId}`;
        return [
          describe(issue),
          issue.description ? `\n目标与验收：\n${issue.description}` : '',
          issue.closeNote ? `\n关闭说明：\n${issue.closeNote}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
    {
      name: 'MessageIssue',
      description:
        '把活派给事项会话。没有会话就先建一个，再把这段话作为下一步发过去。说完就结束这一轮，不要空等。',
      parameters: {
        issueId: { type: 'string', required: true },
        message: {
          type: 'string',
          required: true,
          description: '判断之后的任务：做什么、边界、怎么验收。不要复述用户原话。',
        },
      },
      output: textOutput,
      async execute(args) {
        const issue = await muse.messageIssue(args.issueId, args.message);
        return `已派给 ${issue.sessionId}（${issue.id}）。`;
      },
    },
    {
      name: 'CloseIssue',
      description: '关闭一件事。complete 表示做完，cancel 表示取消。note 写结论或原因。',
      parameters: {
        issueId: { type: 'string', required: true },
        action: { type: 'string', enum: ['complete', 'cancel'], required: true },
        note: { type: 'string' },
      },
      output: textOutput,
      async execute(args) {
        const issue = await muse.closeIssue(args.issueId, args.action, args.note);
        return `已关闭 ${issue.id}（${issue.status}）。`;
      },
    },
  ];

  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool));
  }
}
