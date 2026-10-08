/**
 * LiveConfigManager Tests - Configuration Management with File Watching
 *
 * These tests verify that LiveConfigManager can handle configuration management
 * with file watching after the ConfigurationWatcher merge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import { Container } from "../../src/utils/container.js";
import type { HookManager } from "../../src/managers/hookManager.js";
import {
  ConfigurationService,
  loadMergedMuseConfig,
} from "../../src/services/configurationService.js";
import { resetSharedCatalogsForTests } from "../../src/shared/testing.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import * as configPaths from "../../src/utils/configPaths.js";
import type { MuseConfiguration } from "../../src/types/configuration.js";
import type { ConfigurationLoadResult } from "../../src/types/configuration.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock all dependencies
vi.mock("../../src/services/configurationService.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/services/configurationService.js")
  >();
  return {
    ...actual,
    ConfigurationService: vi.fn(),
    loadMergedMuseConfig: vi.fn(),
  };
});
vi.mock("../../src/services/fileWatcher.js");
vi.mock("../../src/utils/configPaths.js");
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

describe("LiveConfigManager - Configuration Management", () => {
  let liveConfigManager: LiveConfigManager;
  let container: Container;
  let mockHookManager: HookManager;
  let mockPermissionManager: PermissionManager;
  let mockConfigurationService: ConfigurationService;
  let mockFileWatcherService: FileWatcherService;
  let workdir: string;

  beforeEach(() => {
    // Mock logger

    // Mock hook manager
    mockHookManager = {
      loadConfigurationFromMuseConfig: vi.fn(),
    } as Partial<HookManager> as HookManager;

    // Mock permission manager
    mockPermissionManager = {
      updateConfiguredPermissionMode: vi.fn(),
      updateAllowedRules: vi.fn(),
      updateDeniedRules: vi.fn(),
      updateAdditionalDirectories: vi.fn(),
    } as Partial<PermissionManager> as PermissionManager;

    // Mock file watcher service
    mockFileWatcherService = {
      watchFile: vi.fn(),
      cleanup: vi.fn(),
      on: vi.fn(),
      getAllWatcherStatuses: vi.fn().mockReturnValue([]),
    } as Partial<FileWatcherService> as FileWatcherService;

    // Mock configuration service
    mockConfigurationService = {
      loadMergedConfiguration: vi.fn(),
      setEnvironmentVars: vi.fn(),
      setOptions: vi.fn(),
      getConfigurationPaths: vi.fn().mockReturnValue({
        userPaths: ["/mock/user/settings.json"],
        projectPaths: ["/mock/project/.muse-work/settings.json"],
        allPaths: [
          "/mock/user/settings.json",
          "/mock/project/.muse-work/settings.json",
        ],
        existingPaths: [],
      }),
    } as Partial<ConfigurationService> as ConfigurationService;

    // Setup container
    container = new Container();
    container.register("HookManager", mockHookManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("ConfigurationService", mockConfigurationService);

    // Mock config paths
    vi.mocked(configPaths.getUserConfigPaths).mockReturnValue([
      "/mock/user/settings.json",
    ]);
    vi.mocked(configPaths.getProjectConfigPaths).mockReturnValue([
      "/mock/project/.muse-work/settings.json",
    ]);

    // Mock constructors
    vi.mocked(ConfigurationService).mockImplementation(function () {
      return mockConfigurationService;
    });
    vi.mocked(FileWatcherService).mockImplementation(function () {
      return mockFileWatcherService;
    });

    workdir = "/mock/project";
    vi.mocked(loadMergedMuseConfig).mockReturnValue(null);
    liveConfigManager = new LiveConfigManager(container, {
      workdir,
    });
  });

  afterEach(async () => {
    await liveConfigManager.shutdown().catch(() => {});
    await resetSharedCatalogsForTests();
    vi.resetAllMocks();
  });

  describe("Configuration Loading", () => {
    it("should load configuration on initialize", async () => {
      const mockConfig: MuseConfiguration = {
        hooks: {
          PreToolUse: [
            {
              matcher: "test",
              hooks: [{ type: "command", command: "echo test" }],
            },
          ],
        },
      };

      const mockResult: ConfigurationLoadResult = {
        success: true,
        configuration: mockConfig,
        sourcePath: "/mock/project/.muse-work/settings.json",
        warnings: [],
      };

      vi.mocked(loadMergedMuseConfig).mockReturnValue(mockConfig);

      await liveConfigManager.initialize();

      expect(loadMergedMuseConfig).toHaveBeenCalledWith(workdir);
      expect(
        mockHookManager.loadConfigurationFromMuseConfig,
      ).toHaveBeenCalledWith(expect.objectContaining({ hooks: mockConfig.hooks }));
      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        mockConfig,
      );
    });

    it("should handle configuration load failure gracefully", async () => {
      const mockResult: ConfigurationLoadResult = {
        success: false,
        error: "Configuration file not found",
        sourcePath: "/mock/project/.muse-work/settings.json",
        configuration: null,
        warnings: [],
      };

      vi.mocked(loadMergedMuseConfig).mockReturnValue({
        permissions: { defaultMode: "not-a-real-mode" },
      } as MuseConfiguration);

      await liveConfigManager.initialize();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Configuration loading failed"),
      );
    });

    it("should reload configuration when requested", async () => {
      const initialConfig: MuseConfiguration = { hooks: {} };
      const newConfig: MuseConfiguration = {
        hooks: {
          PostToolUse: [
            {
              matcher: "updated",
              hooks: [{ type: "command", command: "echo updated" }],
            },
          ],
        },
      };

      vi.mocked(loadMergedMuseConfig)
        .mockReturnValueOnce(initialConfig)
        .mockReturnValueOnce(newConfig);

      await liveConfigManager.initialize();
      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        initialConfig,
      );

      const reloadedConfig = await liveConfigManager.reload();
      expect(reloadedConfig).toMatchObject(newConfig);
      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        newConfig,
      );
    });

    it("should apply environment variables when present in configuration", async () => {
      const mockConfig: MuseConfiguration = {
        hooks: {},
        env: {
          TEST_VAR: "test_value",
          ANOTHER_VAR: "another_value",
        },
      };

      vi.mocked(loadMergedMuseConfig).mockReturnValue(mockConfig);

      await liveConfigManager.initialize();

      expect(mockConfigurationService.setEnvironmentVars).toHaveBeenCalled();
    });

    it("should handle exceptions during configuration loading", async () => {
      vi.mocked(loadMergedMuseConfig).mockImplementation(() => {
        throw new Error("Configuration service error");
      });

      await liveConfigManager.initialize();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Configuration loading failed"),
      );
    });
  });

  describe("Configuration Management", () => {
    it("should return null when no configuration is loaded", () => {
      expect(liveConfigManager.getCurrentConfiguration()).toBeNull();
    });

    it("should return copy of configuration to prevent mutations", async () => {
      const mockConfig: MuseConfiguration = {
        hooks: {
          PreToolUse: [
            {
              matcher: "test",
              hooks: [{ type: "command", command: "echo test" }],
            },
          ],
        },
      };

      vi.mocked(loadMergedMuseConfig).mockReturnValue(mockConfig);

      await liveConfigManager.initialize();

      const config1 = liveConfigManager.getCurrentConfiguration();
      const config2 = liveConfigManager.getCurrentConfiguration();

      expect(config1).toMatchObject(mockConfig);
      expect(config2).toMatchObject(mockConfig);
      expect(config1).not.toBe(config2); // Should be different objects
      expect(config1).not.toBe(mockConfig); // Should not be the original object
    });

    it("should clean up state on shutdown", async () => {
      const mockConfig: MuseConfiguration = { hooks: {} };
      vi.mocked(loadMergedMuseConfig).mockReturnValue(mockConfig);

      await liveConfigManager.initialize();
      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        mockConfig,
      );

      await liveConfigManager.shutdown();
      expect(liveConfigManager.getCurrentConfiguration()).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should use last valid configuration on reload error", async () => {
      const validConfig: MuseConfiguration = { hooks: {} };
      vi.mocked(loadMergedMuseConfig)
        .mockReturnValueOnce(validConfig)
        .mockReturnValueOnce({
          permissions: { defaultMode: "invalid-mode" },
        } as MuseConfiguration);

      await liveConfigManager.initialize();
      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        validConfig,
      );

      await liveConfigManager.reload();
      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        validConfig,
      );
    });

    it("should handle exceptions during reload gracefully", async () => {
      const validConfig: MuseConfiguration = { hooks: {} };
      vi.mocked(loadMergedMuseConfig)
        .mockReturnValueOnce(validConfig)
        .mockImplementationOnce(() => {
          throw new Error("Service error");
        });

      await liveConfigManager.initialize();
      await liveConfigManager.reload();

      expect(liveConfigManager.getCurrentConfiguration()).toMatchObject(
        validConfig,
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Configuration loading failed"),
      );
    });
  });

  describe("Permission Reload", () => {
    it("should reset permissions to empty arrays when they are missing in the new configuration", async () => {
      const initialConfig: MuseConfiguration = {
        permissions: {
          allow: ["Bash(ls)"],
          deny: ["Bash(rm *)"],
          additionalDirectories: ["/tmp"],
          defaultMode: "default",
        },
      };

      const emptyConfig: MuseConfiguration = {
        permissions: {},
      };

      vi.mocked(loadMergedMuseConfig)
        .mockReturnValueOnce(initialConfig)
        .mockReturnValueOnce(emptyConfig);

      // Initial load
      await liveConfigManager.initialize();

      expect(mockPermissionManager.updateAllowedRules).toHaveBeenCalledWith([
        "Bash(ls)",
      ]);
      expect(mockPermissionManager.updateDeniedRules).toHaveBeenCalledWith([
        "Bash(rm *)",
      ]);
      expect(
        mockPermissionManager.updateAdditionalDirectories,
      ).toHaveBeenCalledWith(["/tmp"]);
      expect(
        mockPermissionManager.updateConfiguredPermissionMode,
      ).toHaveBeenCalledWith("default");

      // Reload with empty permissions
      await liveConfigManager.reload();

      // These should be called with empty arrays/undefined if they are missing in the new config
      expect(mockPermissionManager.updateAllowedRules).toHaveBeenCalledWith([]);
      expect(mockPermissionManager.updateDeniedRules).toHaveBeenCalledWith([]);
      expect(
        mockPermissionManager.updateAdditionalDirectories,
      ).toHaveBeenCalledWith([]);
      expect(
        mockPermissionManager.updateConfiguredPermissionMode,
      ).toHaveBeenCalledWith(undefined);
    });
  });
});
