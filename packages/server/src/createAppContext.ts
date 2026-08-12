import os from "node:os";
import {
  createCodeMakerProvider,
  createOpenAiCompatibleProvider,
  createProviderRegistry,
  loadProvidersConfig,
  type ProviderRegistry,
} from "@muse-work/provider";

export interface AppContext {
  home: string;
  registry: ProviderRegistry;
}

export interface CreateAppContextOptions {
  /** User home used for `~/.muse-work` paths. Overrides `MUSE_HOME`. */
  home?: string;
}

/**
 * Resolve config home: explicit option → `MUSE_HOME` env → `os.homedir()`.
 * `MUSE_HOME` is the parent directory that contains `.muse-work/` (same as
 * `os.homedir()` semantics), so tests can point at a temp dir.
 */
export function resolveHome(options?: CreateAppContextOptions): string {
  return options?.home ?? process.env.MUSE_HOME ?? os.homedir();
}

export function createAppContext(
  options?: CreateAppContextOptions,
): AppContext {
  const home = resolveHome(options);

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
      const envName =
        getConfig().providers["openai-compatible"].apiKeyEnv ??
        "MUSE_OPENAI_API_KEY";
      return process.env[envName];
    },
  });

  const registry = createProviderRegistry([codemaker, openai], home);

  return { home, registry };
}
