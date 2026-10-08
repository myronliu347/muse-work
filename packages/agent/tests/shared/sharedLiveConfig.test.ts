import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { acquireLiveConfig } from "../../src/shared/sharedLiveConfig.js";
import { resetSharedCatalogsForTests } from "../../src/shared/testing.js";
import * as configurationService from "../../src/services/configurationService.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import { existsSync } from "fs";

vi.mock("../../src/services/fileWatcher.js");
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("SharedLiveConfig", () => {
  let mockWatchFile: ReturnType<typeof vi.fn>;
  let constructCount = 0;

  beforeEach(() => {
    constructCount = 0;
    mockWatchFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(FileWatcherService).mockImplementation(function () {
      constructCount++;
      return {
        watchFile: mockWatchFile,
        cleanup: vi.fn().mockResolvedValue(undefined),
        on: vi.fn().mockReturnThis(),
      };
    } as unknown as typeof FileWatcherService);
  });

  afterEach(async () => {
    await resetSharedCatalogsForTests();
    vi.restoreAllMocks();
  });

  it("watches user config parent when settings file is missing", async () => {
    vi.spyOn(configurationService, "loadMergedMuseConfig").mockReturnValue({
      env: { FOO: "1" },
    });
    vi.spyOn(
      configurationService,
      "validateConfigurationObject",
    ).mockReturnValue({ isValid: true, warnings: [], errors: [] });

    const handle = await acquireLiveConfig("/tmp/project", () => {});
    expect(mockWatchFile).toHaveBeenCalled();
    const watchedPaths = mockWatchFile.mock.calls.map((c) => String(c[0]));
    expect(watchedPaths.some((p) => existsSync(p) || p.includes(".muse-work"))).toBe(
      true,
    );
    handle.unsubscribe();
    expect(constructCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps lastValid when validation fails on reload", async () => {
    const loadMerged = vi.spyOn(configurationService, "loadMergedMuseConfig");
    const validate = vi.spyOn(
      configurationService,
      "validateConfigurationObject",
    );

    loadMerged.mockReturnValueOnce({ hooks: { PreToolUse: [] } });
    validate.mockReturnValueOnce({
      isValid: true,
      warnings: [],
      errors: [],
    });

    const handle = await acquireLiveConfig("/tmp/valid", () => {});
    const good = handle.getPayload().lastValid;

    loadMerged.mockReturnValueOnce({ hooks: { bad: true } });
    validate.mockReturnValueOnce({
      isValid: false,
      warnings: [],
      errors: ["invalid"],
    });

    const { requestLiveConfigReload } = await import(
      "../../src/shared/sharedLiveConfig.js"
    );
    await requestLiveConfigReload("/tmp/valid");
    expect(handle.getPayload().loadSuccess).toBe(false);
    expect(handle.getPayload().lastValid).toEqual(good);
    handle.unsubscribe();
  });
});
