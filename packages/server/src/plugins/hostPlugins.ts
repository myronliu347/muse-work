import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getMuseHomeDir, type AiProvider } from "@muse-work/provider";
import type {
  AssistantApp,
  AssistantTool,
  MusePlugin,
  PluginContext,
  PluginLogger,
  SettingsPanel,
} from "@muse-work/plugin-sdk";

export type PluginRoute = (request: Request) => Promise<Response>;

export interface HostContributions {
  providers: AiProvider[];
  routes: PluginRoute[];
  apps: AssistantApp[];
  tools: AssistantTool[];
  panels: SettingsPanel[];
}

export interface PreparedPlugin {
  plugin: MusePlugin;
  context: PluginContext;
  port: { value: number };
}

export interface AssistantBridge {
  recordInbound: PluginContext["assistant"]["recordInbound"];
  enqueue: PluginContext["assistant"]["enqueue"];
}

export function createAssistantBridge(): AssistantBridge {
  return {
    recordInbound() {},
    enqueue() {},
  };
}

export function emptyContributions(): HostContributions {
  return { providers: [], routes: [], apps: [], tools: [], panels: [] };
}

function isFileSpec(spec: string): boolean {
  return (
    spec.startsWith(".") ||
    path.isAbsolute(spec) ||
    spec.endsWith(".js") ||
    spec.endsWith(".mjs") ||
    spec.endsWith(".cjs") ||
    spec.endsWith(".ts")
  );
}

function isMissingModule(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/** Bundled plugins dropped into `~/.muse-work/host-plugins`. */
export function installedHostPluginSpecs(home: string): string[] {
  const dir = path.join(getMuseHomeDir(home), "host-plugins");
  if (!fs.existsSync(dir)) return [];
  const specs: string[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const index = path.join(full, "index.js");
      if (fs.existsSync(index)) specs.push(index);
      continue;
    }
    if (name.endsWith(".js") || name.endsWith(".mjs")) specs.push(full);
  }
  return specs;
}

/** `none` means the environment explicitly disabled plugins. */
export function resolveHostPluginSpecs(home: string): string[] | "none" {
  const env = process.env.MUSE_HOST_PLUGINS;
  if (env !== undefined) {
    const trimmed = env.trim();
    if (trimmed === "" || trimmed === "0") return "none";
    return trimmed
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const configPath = path.join(getMuseHomeDir(home), "host-plugins.json");
  if (!fs.existsSync(configPath)) return installedHostPluginSpecs(home);

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    throw new Error(
      `无法读取 ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const modules = (raw as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) {
    throw new Error(`${configPath} 缺少 modules 数组`);
  }
  return modules.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

export async function importHostPlugin(spec: string): Promise<MusePlugin> {
  const specifier = isFileSpec(spec)
    ? pathToFileURL(path.resolve(spec)).href
    : spec;
  const mod = (await import(specifier)) as {
    plugin?: MusePlugin;
    default?: MusePlugin;
  };
  const plugin = mod.plugin ?? mod.default;
  if (
    !plugin ||
    typeof plugin.id !== "string" ||
    typeof plugin.register !== "function"
  ) {
    throw new Error(`宿主插件 ${spec} 没有可用的 plugin 导出`);
  }
  return plugin;
}

export async function loadHostPlugins(
  home: string,
  logger: PluginLogger,
): Promise<MusePlugin[]> {
  let specs: string[] | "none";
  try {
    specs = resolveHostPluginSpecs(home);
  } catch (err) {
    logger.warn("host plugin config skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  if (specs === "none") return [];

  const plugins: MusePlugin[] = [];
  for (const spec of specs) {
    try {
      plugins.push(await importHostPlugin(spec));
    } catch (err) {
      logger.warn(isMissingModule(err) ? "host plugin not installed" : "host plugin skipped", {
        spec,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return plugins;
}

export function createPluginContext(options: {
  home: string;
  port: { value: number };
  logger: PluginLogger;
  bucket: HostContributions;
  bridge: AssistantBridge;
}): PluginContext {
  return {
    home: options.home,
    get requestedMainPort() {
      return options.port.value;
    },
    logger: options.logger,
    registerProvider(provider) {
      options.bucket.providers.push(provider);
    },
    route(handle) {
      options.bucket.routes.push(handle);
    },
    assistant: {
      registerApp(app) {
        options.bucket.apps.push(app);
      },
      registerTool(tool) {
        options.bucket.tools.push(tool);
      },
      recordInbound(event) {
        options.bridge.recordInbound(event);
      },
      enqueue(event) {
        options.bridge.enqueue(event);
      },
    },
    settings: {
      register(panel) {
        options.bucket.panels.push(panel);
      },
    },
  };
}

/** Register each plugin into its own bucket. A throw drops that plugin only. */
export async function prepareHostPlugins(options: {
  home: string;
  plugins: MusePlugin[];
  logger: PluginLogger;
  bridge?: AssistantBridge;
}): Promise<{ contributions: HostContributions; prepared: PreparedPlugin[] }> {
  const contributions = emptyContributions();
  const prepared: PreparedPlugin[] = [];
  const bridge = options.bridge ?? createAssistantBridge();
  for (const plugin of options.plugins) {
    const bucket = emptyContributions();
    const port = { value: 0 };
    const context = createPluginContext({
      home: options.home,
      port,
      logger: options.logger,
      bucket,
      bridge,
    });
    try {
      await plugin.register(context);
    } catch (err) {
      options.logger.warn("host plugin register failed", {
        id: plugin.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    contributions.providers.push(...bucket.providers);
    contributions.routes.push(...bucket.routes);
    contributions.apps.push(...bucket.apps);
    contributions.tools.push(...bucket.tools);
    contributions.panels.push(...bucket.panels);
    prepared.push({ plugin, context, port });
  }
  return { contributions, prepared };
}

export async function startPreparedPlugins(
  prepared: PreparedPlugin[],
  requestedMainPort: number,
  logger: PluginLogger,
): Promise<void> {
  for (const slot of prepared) {
    slot.port.value = requestedMainPort;
    if (!slot.plugin.start) continue;
    try {
      await slot.plugin.start(slot.context);
    } catch (err) {
      logger.warn("host plugin start failed", {
        id: slot.plugin.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
