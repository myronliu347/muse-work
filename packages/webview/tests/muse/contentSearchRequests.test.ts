import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptDesktopContentSearchResult,
  allocateDesktopContentSearchRequestId,
  noteDesktopContentSearchRequest,
  resetDesktopContentSearchRequests,
} from "../../src/muse/contentSearchRequests";

describe("desktop content search request ids", () => {
  beforeEach(() => {
    resetDesktopContentSearchRequests();
  });

  it("gives two panes different ids so the first result stays on its workdir", () => {
    const firstId = allocateDesktopContentSearchRequestId();
    const secondId = allocateDesktopContentSearchRequestId();
    expect(firstId).not.toBe(secondId);

    noteDesktopContentSearchRequest("/work/pane-a", firstId);
    noteDesktopContentSearchRequest("/work/pane-b", secondId);

    expect(acceptDesktopContentSearchResult(firstId)).toBe("/work/pane-a");
  });
});
