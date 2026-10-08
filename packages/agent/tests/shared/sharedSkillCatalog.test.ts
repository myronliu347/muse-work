import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acquireSkillCatalog,
  requestSkillCatalogRefresh,
} from "../../src/shared/sharedSkillCatalog.js";
import { resetSharedCatalogsForTests } from "../../src/shared/testing.js";
import * as diskSkillDiscovery from "../../src/shared/diskSkillDiscovery.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";

vi.mock("../../src/services/fileWatcher.js");
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("SharedSkillCatalog", () => {
  let constructCount = 0;
  let mockWatchFile: ReturnType<typeof vi.fn>;
  let mockCleanup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    constructCount = 0;
    mockWatchFile = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn().mockResolvedValue(undefined);
    vi.mocked(FileWatcherService).mockImplementation(function () {
      constructCount++;
      return {
        watchFile: mockWatchFile,
        cleanup: mockCleanup,
        on: vi.fn().mockReturnThis(),
      };
    } as unknown as typeof FileWatcherService);

    vi.spyOn(diskSkillDiscovery, "discoverDiskSkills").mockResolvedValue({
      metadata: new Map(),
      content: new Map(),
      errors: [],
    });
  });

  afterEach(async () => {
    await resetSharedCatalogsForTests();
    vi.restoreAllMocks();
  });

  it("double acquire same workdir shares one global personal + one project watcher", async () => {
    const heard: string[] = [];
    const h1 = await acquireSkillCatalog(
      "/tmp/wd-a",
      { watch: true },
      async () => {
        heard.push("a1");
      },
    );
    const h2 = await acquireSkillCatalog(
      "/tmp/wd-a",
      { watch: true },
      async () => {
        heard.push("a2");
      },
    );
    expect(heard).toContain("a1");
    expect(heard).toContain("a2");
    // 1 global personal watcher + 1 project watcher for the workdir
    expect(constructCount).toBe(2);

    h1.unsubscribe();
    h2.unsubscribe();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("concurrent acquire only discovers disk once (singleflight init)", async () => {
    const discover = vi.mocked(diskSkillDiscovery.discoverDiskSkills);
    await Promise.all([
      acquireSkillCatalog("/tmp/wd-b", { watch: false }, () => {}),
      acquireSkillCatalog("/tmp/wd-b", { watch: false }, () => {}),
    ]);
    expect(discover.mock.calls.length).toBe(1);
    await resetSharedCatalogsForTests();
  });

  it("later acquire with watch:true enables watchers after watch:false", async () => {
    const h1 = await acquireSkillCatalog("/tmp/wd-c", { watch: false }, () => {});
    expect(constructCount).toBe(0);
    const h2 = await acquireSkillCatalog("/tmp/wd-c", { watch: true }, () => {});
    expect(constructCount).toBe(2);
    h1.unsubscribe();
    h2.unsubscribe();
  });

  it("requestSkillCatalogRefresh notifies all listeners", async () => {
    const calls: number[] = [];
    const h1 = await acquireSkillCatalog("/tmp/wd-d", { watch: false }, async () => {
      calls.push(1);
    });
    const h2 = await acquireSkillCatalog("/tmp/wd-d", { watch: false }, async () => {
      calls.push(2);
    });
    calls.length = 0;
    await requestSkillCatalogRefresh("/tmp/wd-d");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    h1.unsubscribe();
    h2.unsubscribe();
  });
});
