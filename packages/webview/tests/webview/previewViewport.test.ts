/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  matchPreviewDevice,
  parsePreviewDimension,
  previewViewportMobile,
  previewViewportScale,
} from "../../src/components/panels/previewViewport";

describe("previewViewport", () => {
  it("matches a device in either orientation", () => {
    expect(matchPreviewDevice(390, 844)?.id).toBe("iphone-16e");
    expect(matchPreviewDevice(844, 390)?.id).toBe("iphone-16e");
    expect(matchPreviewDevice(500, 800)).toBeNull();
    expect(previewViewportMobile(390, 844)).toBe(true);
    expect(previewViewportMobile(1920, 1080)).toBe(false);
  });

  it("rejects dimensions outside the usable range", () => {
    expect(parsePreviewDimension("390")).toBe(390);
    expect(parsePreviewDimension("199")).toBeNull();
    expect(parsePreviewDimension("12.5")).toBeNull();
    expect(parsePreviewDimension("")).toBeNull();
  });

  it("scales a frame down to the stage and leaves an unmeasured stage at 1", () => {
    expect(previewViewportScale({ width: 390, height: 844 }, { width: 0, height: 0 })).toBe(1);
    expect(previewViewportScale({ width: 1000, height: 800 }, { width: 420, height: 600 })).toBeCloseTo(
      (420 - 32) / 1000,
    );
    expect(previewViewportScale({ width: 390, height: 844 }, { width: 800, height: 1200 })).toBe(1);
  });
});
