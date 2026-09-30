# @muse-work/agent

Muse Agent 运行时。从 `wave-agent-sdk` fork，在本 monorepo 内作为 `@muse-work/agent` 维护。

```ts
import { Agent } from "@muse-work/agent";
import type { Message } from "@muse-work/agent/types";
import { AGENT_TOOL_NAME } from "@muse-work/agent/constants";
```

## Scripts

```bash
pnpm -F @muse-work/agent build
pnpm -F @muse-work/agent test:unit
pnpm -F @muse-work/agent type-check
```
