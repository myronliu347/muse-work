import {
  createCodeMakerProvider,
  createOpenAiCompatibleProvider,
  createProviderRegistry,
  loadProvidersConfig,
  type ProviderRegistry,
} from "@muse-work/provider";
import { resolveHome } from "../utils/paths.js";
import {
  createSessionRunner,
  type CreateAgent,
  type SessionAgent,
  type SessionRunner,
} from "./sessionRunner.js";
import { createSessionStore, type SessionStore } from "./sessionStore.js";
import { createTodoStore, type TodoStore } from "./todoStore.js";
import { createTodoScheduler, type TodoScheduler } from "./todoScheduler.js";
import { createWsHub, type WsHub } from "./wsHub.js";

export { resolveHome };

export type { CreateAgent, SessionAgent };

export interface AppContext {
  home: string;
  registry: ProviderRegistry;
  store: SessionStore;
  hub: WsHub;
  runner: SessionRunner;
  /** Todo/Task 任务管理存储（spec 2026-08-21）。 */
  todoStore: TodoStore;
  /** Todo/Task 常驻执行调度器（server 启动后 start()）。 */
  todoScheduler: TodoScheduler;
  /** POPO 机器人运行时（未启用时为 undefined） */
  popo?: import("../popo/setup.js").PopoRuntime;
}

export interface CreateAppContextOptions {
  /** User home used for `~/.muse-work` paths. Overrides `MUSE_HOME`. */
  home?: string;
  /** Injectable Agent factory for tests. */
  createAgent?: CreateAgent;
  /** Idle TTL before destroying session runtime (default 10min). */
  idleTtlMs?: number;
  /** Loader for subagent transcripts (tests); defaults to SDK disk read. */
  loadSubagentMessages?: (
    subagentId: string,
    workdir: string,
  ) => Promise<unknown[] | null>;
}

export interface CreateSessionServicesOptions {
  home: string;
  registry: ProviderRegistry;
  createAgent?: CreateAgent;
  idleTtlMs?: number;
  loadSubagentMessages?: CreateAppContextOptions["loadSubagentMessages"];
}

export function createSessionServices(
  options: CreateSessionServicesOptions,
): Pick<AppContext, "store" | "hub" | "runner"> {
  const store = createSessionStore({ home: options.home });
  const hub = createWsHub();
  const runner = createSessionRunner({
    store,
    hub,
    registry: options.registry,
    home: options.home,
    createAgent: options.createAgent,
    idleTtlMs: options.idleTtlMs,
    loadSubagentMessages: options.loadSubagentMessages,
  });
  hub.setSnapshotProvider(() => runner.snapshotEvents());
  return { store, hub, runner };
}

export function createAppContext(
  options?: CreateAppContextOptions,
): AppContext {
  const home = resolveHome(options?.home);

  const getConfig = () => loadProvidersConfig(home);

  const codemaker = createCodeMakerProvider({
    home,
    getConfig: () => getConfig().providers.codemaker,
    // Prefer returning authUrl to UI/desktop; do not auto-open here.
    openBrowser: () => {},
  });

  const openai = createOpenAiCompatibleProvider({
    getConfig: () => getConfig().providers["openai-compatible"],
    getApiKey: () => {
      const cfg = getConfig().providers["openai-compatible"];
      if (cfg.apiKey) return cfg.apiKey;
      const envName = cfg.apiKeyEnv ?? "MUSE_OPENAI_API_KEY";
      return process.env[envName];
    },
  });

  const registry = createProviderRegistry([codemaker, openai], home);
  const sessions = createSessionServices({
    home,
    registry,
    createAgent: options?.createAgent,
    idleTtlMs: options?.idleTtlMs,
    loadSubagentMessages: options?.loadSubagentMessages,
  });
  const todoStore = createTodoStore({ home });

  const todoScheduler = createTodoScheduler({
    store: todoStore,
    runner: sessions.runner,
    sessionStore: sessions.store,
    registry,
    hub: sessions.hub,
    home,
  });
  // runner ↔ scheduler 循环引用：runner 先建，turn 结束回调后绑定。
  sessions.runner.setOnTurnSettled?.(todoScheduler.handleTurnSettled);

  return { home, registry, ...sessions, todoStore, todoScheduler };
}
