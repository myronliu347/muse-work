import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearResolvedImageBlobCacheForTests,
  isFilesystemImagePath,
  isImmediateImageSrc,
  resolveImageSrc,
} from "../../src/utils/resolveImageSrc";

describe("resolveImageSrc", () => {
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;

  beforeEach(() => {
    clearResolvedImageBlobCacheForTests();
    URL.createObjectURL = vi.fn(() => "blob:resolved") as typeof URL.createObjectURL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    clearResolvedImageBlobCacheForTests();
  });

  it("detects immediate and filesystem refs", () => {
    expect(isImmediateImageSrc("data:image/png;base64,aa")).toBe(true);
    expect(isImmediateImageSrc("blob:abc")).toBe(true);
    expect(isFilesystemImagePath("/tmp/muse-work/uploads/a.png")).toBe(true);
    expect(isFilesystemImagePath("C:\\tmp\\a.png")).toBe(true);
    expect(isFilesystemImagePath("data:image/png;base64,aa")).toBe(false);
  });

  it("passes data URLs through", async () => {
    const src = "data:image/png;base64,aa";
    await expect(resolveImageSrc(src)).resolves.toBe(src);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("reads filesystem paths once into a cached blob URL", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    })) as unknown as typeof fetch;

    const path = "/tmp/muse-work/uploads/shot.png";
    await expect(resolveImageSrc(path)).resolves.toBe("blob:resolved");
    await expect(resolveImageSrc(path)).resolves.toBe("blob:resolved");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
