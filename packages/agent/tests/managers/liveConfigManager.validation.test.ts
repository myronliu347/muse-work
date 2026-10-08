/**
 * LiveConfigManager Validation Tests
 *
 * These tests verify that LiveConfigManager correctly validates configuration,
 * specifically the permissionMode property.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveConfigManager } from "../../src/managers/liveConfigManager.js";
import { Container } from "../../src/utils/container.js";
import {
  ConfigurationService,
  loadMergedMuseConfig,
} from "../../src/services/configurationService.js";
import { resetSharedCatalogsForTests } from "../../src/shared/testing.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
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
vi.mock("../../src/utils/fileUtils.js");
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

describe("LiveConfigManager - Validation", () => {
  let liveConfigManager: LiveConfigManager;
  let container: Container;
  let mockConfigurationService: ConfigurationService;
  let workdir: string;

  beforeEach(() => {
    // Mock logger

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
      return {
        on: vi.fn(),
        watchFile: vi.fn(),
        cleanup: vi.fn(),
        getAllWatcherStatuses: vi.fn().mockReturnValue([]),
      } as Partial<FileWatcherService> as FileWatcherService;
    });

    workdir = "/mock/project";
    liveConfigManager = new LiveConfigManager(container, {
      workdir,
    });
  });

  afterEach(async () => {
    await liveConfigManager.shutdown().catch(() => {});
    await resetSharedCatalogsForTests();
    vi.resetAllMocks();
  });

  describe("permissionMode validation", () => {
    const testValidation = async (
      permissionMode: unknown,
      expectedValid: boolean,
    ) => {
      const mockConfig = {
        permissions: {
          defaultMode: permissionMode,
        },
      } as unknown as MuseConfiguration;

      vi.mocked(loadMergedMuseConfig).mockReturnValue(mockConfig);

      await liveConfigManager.initialize();

      if (expectedValid) {
        expect(liveConfigManager.getCurrentConfiguration()?.permissions).toEqual(
          mockConfig.permissions,
        );
        expect(logger.error).not.toHaveBeenCalledWith(
          expect.stringContaining("Configuration loading failed"),
        );
      } else {
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining("Configuration loading failed"),
        );
      }
    };

    it('should accept "default" as a valid permissionMode', async () => {
      await testValidation("default", true);
    });

    it('should accept "bypassPermissions" as a valid permissionMode', async () => {
      await testValidation("bypassPermissions", true);
    });

    it('should accept "acceptEdits" as a valid permissionMode', async () => {
      await testValidation("acceptEdits", true);
    });

    it('should accept "dontAsk" as a valid permissionMode', async () => {
      await testValidation("dontAsk", true);
    });

    it("should reject invalid permissionMode values", async () => {
      await testValidation("invalidMode", false);
    });

    it("should reject numeric permissionMode values", async () => {
      await testValidation(123, false);
    });

    it("should reject boolean permissionMode values", async () => {
      await testValidation(true, false);
    });
  });
});
