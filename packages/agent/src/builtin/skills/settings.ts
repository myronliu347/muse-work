export const settingsSkills: Record<string, string> = {
  "skills/settings/SKILL.md": `---
name: settings
description: Configure Muse Agent settings.json (env, hooks, MCP, permissions, memory)
---

Use these notes when the user asks how to configure Muse.

- \`~/.muse-work/settings.json\` — user scope
- \`<project>/.muse-work/settings.json\` — project scope
- \`<project>/.muse-work/settings.local.json\` — local overrides (do not commit secrets)

See sibling docs in this skill for env, hooks, MCP, permissions, memory, models, skills, and subagents.
`,
  "skills/settings/ENV.md": `# Environment variables

Put string key-value pairs in \`settings.json\` \`env\`. \`WAVE_*\` aliases are still read.

| Variable | Description |
| :--- | :--- |
| \`MUSE_API_KEY\` | Gateway API key |
| \`MUSE_BASE_URL\` | Gateway base URL |
| \`MUSE_CUSTOM_HEADERS\` | Newline-separated \`Key: Value\` headers |
| \`MUSE_MODEL\` | Primary model |
| \`MUSE_FAST_MODEL\` | Fast model |
| \`MUSE_VISION_MODEL\` | Vision model for the builtin vision subagent |
| \`MUSE_MAX_INPUT_TOKENS\` | Input token budget |
| \`MUSE_MAX_OUTPUT_TOKENS\` | Output token budget |
| \`MUSE_DISABLE_AUTO_MEMORY\` | \`1\` / \`true\` disables auto-memory |
| \`MUSE_AUTO_MEMORY_FREQUENCY\` | Extract memory every N turns |

Custom \`env\` keys are visible to hooks and Bash. Settings \`env\` is per-session and does not mutate \`process.env\` (except the few keys Muse mirrors for process-level services).
`,
  "skills/settings/HOOKS.md": `# Hooks

\`hooks\` maps events to command arrays. Common events: \`PreToolUse\`, \`PostToolUse\`, \`UserPromptSubmit\`, \`Stop\`, \`SubagentStop\`, \`SessionStart\`, \`SessionEnd\`, \`PreCompact\`, \`PostCompact\`, \`CwdChanged\`.

Each hook receives JSON on stdin (cwd, session, tool name/input when applicable). Exit 0 continues; non-zero can block depending on the event.

Stop hooks receive \`background_tasks\` (running shell / subagent / workflow snapshots).
`,
  "skills/settings/MCP.md": `# MCP

Configure servers in \`.mcp.json\` or plugin \`.mcp.json\`. Transports: \`stdio\` (command + args), \`sse\`, \`http\`. Muse loads plugin MCP servers from local plugin directories passed to \`Agent.create({ plugins })\`.
`,
  "skills/settings/MEMORY.md": `# Memory

Project memory lives under the session workdir. Auto-memory writes to the auto-memory directory when enabled. Toggle with \`autoMemoryEnabled\` / \`autoMemoryFrequency\` or \`MUSE_DISABLE_AUTO_MEMORY\`.
`,
  "skills/settings/MODELS.md": `# Models

Set \`model\` for the default, and \`models.<name>\` for per-model overrides (vision, prompt caching, max tokens, thinking options).
`,
  "skills/settings/PERMISSIONS.md": `# Permissions

\`permissions.allow\` / \`permissions.deny\` use \`ToolName\` or \`ToolName(pattern)\`. \`permissions.defaultMode\` is \`default\`, \`acceptEdits\`, \`plan\`, or \`bypassPermissions\`. \`additionalDirectories\` expands the safe zone for file tools.
`,
  "skills/settings/PLUGINS.md": `# Plugins

Muse loads **local plugin directories** via \`Agent.create({ plugins: [{ type: "local", path }] })\`. There is no remote plugin marketplace. Enable optional bundled plugins from Muse settings (superpowers / mattpocock); issue, automation, and popo-notify are mounted by the host when relevant.

A plugin root needs \`.muse-plugin/plugin.json\` plus optional \`commands/\`, \`skills/\`, \`agents/\`, hooks, and MCP/LSP config.
`,
  "skills/settings/SKILLS.md": `# Skills

Skills are \`SKILL.md\` files under user/project/\`.agents\` skill directories, plus plugin skills. Invoke with the Skill tool. Feature-gated Wave-only skills (artifact, loop, daemon) are not shipped.
`,
  "skills/settings/SUBAGENTS.md": `# Subagents

Define agents as markdown files with frontmatter. The Agent tool launches them. Plugin \`agents/\` directories are registered when the plugin loads.
`,
};
