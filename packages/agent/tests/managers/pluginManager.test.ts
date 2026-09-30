import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginManager } from "../../src/managers/pluginManager.js";
import { Container } from "../../src/utils/container.js";
import { PluginLoader } from "../../src/services/pluginLoader.js";
import {
  PluginConfig,
  PluginManifest,
  CustomSlashCommand,
  Skill,
  LspConfig,
  McpConfig,
  PartialHookConfiguration,
} from "../../src/types/index.js";
import * as path from "path";
import { existsSync, readdirSync } from "fs";
import { SkillManager } from "../../src/managers/skillManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { LspManager } from "../../src/managers/lspManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/pluginLoader.js");
vi.mock("../../src/utils/builtinEmbed.js", () => ({
  ensureBuiltinMaterialized: () => "/fake-builtin-root",
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: vi.fn(), readdirSync: vi.fn() };
});

describe("PluginManager", () => {
  let pluginManager: PluginManager;
  let container: Container;
  let mockSkillManager: SkillManager;
  let mockHookManager: HookManager;
  let mockLspManager: LspManager;
  let mockMcpManager: McpManager;
  let mockSlashCommandManager: SlashCommandManager;
  let mockPermissionManager: PermissionManager;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

    mockSkillManager = {
      registerPluginSkills: vi.fn(),
    } as unknown as SkillManager;
    mockHookManager = {
      registerPluginHooks: vi.fn(),
    } as unknown as HookManager;
    mockLspManager = { registerServer: vi.fn() } as unknown as LspManager;
    mockMcpManager = { addServer: vi.fn() } as unknown as McpManager;
    mockSlashCommandManager = {
      registerPluginCommands: vi.fn(),
    } as unknown as SlashCommandManager;
    mockPermissionManager = {
      addInstanceAllowedRule: vi.fn(),
    } as unknown as PermissionManager;

    const mockConfigurationService = {
      getMergedEnabledPlugins: vi.fn().mockReturnValue({}),
    };

    container = new Container();
    container.register("SkillManager", mockSkillManager);
    container.register("HookManager", mockHookManager);
    container.register("LspManager", mockLspManager);
    container.register("McpManager", mockMcpManager);
    container.register("SlashCommandManager", mockSlashCommandManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register(
      "ConfigurationService",
      mockConfigurationService as unknown as Record<string, unknown>,
    );


    pluginManager = new PluginManager(container, {
      workdir,
    });
    // Expose mockConfigurationService for tests
    (
      pluginManager as unknown as {
        mockConfigurationService: typeof mockConfigurationService;
      }
    ).mockConfigurationService = mockConfigurationService;
  });

  describe("loadPlugins", () => {
    it("should load local plugins and register components successfully", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
      ];
      const manifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      };
      const commands = [
        { name: "test", description: "test command", run: vi.fn() },
      ];
      const skills = [{ name: "skill1" }];
      const lspConfig = { go: { command: "gopls" } };
      const mcpConfig = { mcpServers: { test: { command: "test" } } };
      const hooksConfig = { UserPromptSubmit: [] };

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue(
        commands as unknown as CustomSlashCommand[],
      );
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue(
        skills as unknown as Skill[],
      );
      vi.mocked(PluginLoader.loadLspConfig).mockResolvedValue(
        lspConfig as unknown as LspConfig,
      );
      vi.mocked(PluginLoader.loadMcpConfig).mockResolvedValue(
        mcpConfig as unknown as McpConfig,
      );
      vi.mocked(PluginLoader.loadHooksConfig).mockResolvedValue(
        hooksConfig as unknown as PartialHookConfiguration,
      );

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toMatchObject({
        ...manifest,
        path: path.resolve(workdir, configs[0].path),
        commands,
        skills,
        lspConfig,
        mcpConfig,
        hooksConfig,
      });

      expect(
        mockSlashCommandManager.registerPluginCommands,
      ).toHaveBeenCalledWith("test-plugin", commands);
      expect(mockSkillManager.registerPluginSkills).toHaveBeenCalledWith(
        "test-plugin",
        skills,
      );
      expect(mockLspManager.registerServer).toHaveBeenCalledWith("go", {
        ...lspConfig.go,
        pluginRoot: path.resolve(workdir, configs[0].path),
      });
      expect(mockMcpManager.addServer).toHaveBeenCalledWith("test", {
        ...mcpConfig.mcpServers.test,
        pluginRoot: path.resolve(workdir, configs[0].path),
      });
      expect(mockHookManager.registerPluginHooks).toHaveBeenCalledWith(
        path.resolve(workdir, configs[0].path),
        hooksConfig,
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Loaded plugin: test-plugin"),
      );
    });

    it("should default a manifest without version to 1.0.0", async () => {
      // CC 生态的 plugin.json 常常没有 version 字段（spec plugin A-022）
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
      ];

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue({
        name: "test-plugin",
        description: "A test plugin",
      } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      const failures = await pluginManager.loadPlugins(configs);

      expect(failures).toEqual([]);
      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].version).toBe("1.0.0");
      expect(logger.debug).toHaveBeenCalledWith(
        "Loaded plugin: test-plugin v1.0.0",
      );
    });

    it("should keep loading a plugin when one of its MCP servers is unusable", async () => {
      // 一个坏 server 声明不能拖垮整个插件（spec plugin A-023）
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
      ];
      const manifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      };
      const mcpConfig = {
        mcpServers: {
          bad: { command: "bad" },
          good: { command: "good" },
        },
      };

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);
      vi.mocked(PluginLoader.loadMcpConfig).mockResolvedValue(
        mcpConfig as unknown as McpConfig,
      );
      vi.mocked(mockMcpManager.addServer).mockImplementation((name) => {
        if (name === "bad") throw new Error("Invalid server config");
        return true;
      });

      const failures = await pluginManager.loadPlugins(configs);

      expect(failures).toEqual([]);
      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to register MCP server 'bad' from plugin test-plugin: Invalid server config",
      );
      expect(mockMcpManager.addServer).toHaveBeenCalledWith("good", {
        command: "good",
        pluginRoot: path.resolve(workdir, configs[0].path),
      });
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should skip unsupported plugin types", async () => {
      const configs: PluginConfig[] = [
        { type: "remote" as unknown as "local", path: "http://example.com" },
      ];

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unsupported plugin type: remote"),
      );
    });

    it("should skip already loaded plugins", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/test-plugin" },
        { type: "local", path: "plugins/test-plugin-duplicate" },
      ];
      const manifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      };

      vi.mocked(PluginLoader.loadManifest).mockResolvedValue(
        manifest as PluginManifest,
      );
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Plugin with name 'test-plugin' is already loaded",
        ),
      );
    });

    it("should handle errors during plugin loading", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/invalid-plugin" },
      ];
      const error = new Error("Manifest not found");

      vi.mocked(PluginLoader.loadManifest).mockRejectedValue(error);

      await pluginManager.loadPlugins(configs);

      expect(pluginManager.getPlugins()).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to load plugin from ${path.resolve(workdir, configs[0].path)}`,
        ),
        error,
      );
    });

    it("should return all loaded plugins", async () => {
      const configs: PluginConfig[] = [
        { type: "local", path: "plugins/p1" },
        { type: "local", path: "plugins/p2" },
      ];

      vi.mocked(PluginLoader.loadManifest)
        .mockResolvedValueOnce({
          name: "p1",
          version: "1.0.0",
          description: "d1",
        } as PluginManifest)
        .mockResolvedValueOnce({
          name: "p2",
          version: "1.0.0",
          description: "d2",
        } as PluginManifest);
      vi.mocked(PluginLoader.loadCommands).mockReturnValue([]);
      vi.mocked(PluginLoader.loadSkills).mockResolvedValue([]);

      await pluginManager.loadPlugins(configs);

      const plugins = pluginManager.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(pluginManager.getPlugin("p1")).toBeDefined();
      expect(pluginManager.getPlugin("p2")).toBeDefined();
      expect(pluginManager.getPlugin("p3")).toBeUndefined();
    });
  });
});
