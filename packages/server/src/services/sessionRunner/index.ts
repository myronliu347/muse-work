import { createRunnerContext } from "./ctx.js";
import { createCore } from "./core.js";
import { createAgentLayer } from "./agent.js";
import { createActions } from "./actions.js";
import type { CreateSessionRunnerOptions, SessionRunner } from "./ctx.js";

/**
 * sessionRunner/ — createSessionRunner split into a one-way dependency stack:
 *   L1 ctx.ts + serialization.ts (types, shared state, pure helpers)
 *   L2 core.ts        (lifecycle cross-cutting, assembled first)
 *   L3 agent.ts       (agent runtime + SDK callbacks, reaches core via ctx.core)
 *   L4 actions.ts     (public SessionRunner methods, reaches both via ctx)
 *   L5 index.ts       (assembly entry, re-exports the previous module surface)
 */
export function createSessionRunner(
  options: CreateSessionRunnerOptions,
): SessionRunner {
  const ctx = createRunnerContext(options);
  ctx.core = createCore(ctx);
  ctx.agent = createAgentLayer(ctx);
  return createActions(ctx);
}

// --- re-exports preserving the previous sessionRunner.ts module surface ---
export {
  resolveModelDisplay,
  SYSTEM_INJECT_OPEN,
  SYSTEM_INJECT_CLOSE,
  wrapSystemInject,
  isSystemInjectContent,
  defaultCreateAgent,
} from "./ctx.js";
export type {
  SessionImage,
  SessionAgent,
  CreateAgent,
  OutboundImage,
  SessionRunner,
  CreateSessionRunnerOptions,
} from "./ctx.js";
export type { EMPTY_TURN_ERROR } from "../../constants/agent.js";
