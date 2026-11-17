/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  isIssueUpdateUnread,
  markIssueSeen,
  markIssuesSeen,
  resetIssueSeenForTests,
} from "../../src/muse/issueSeen";

describe("issueSeen", () => {
  beforeEach(() => {
    resetIssueSeenForTests();
  });

  it("marks an issue read at the latest timestamp", () => {
    expect(isIssueUpdateUnread("a", 100)).toBe(true);
    markIssueSeen("a", 200);
    expect(isIssueUpdateUnread("a", 150)).toBe(false);
    expect(isIssueUpdateUnread("a", 250)).toBe(true);
  });

  it("marks many issues read and persists", () => {
    markIssuesSeen(["a", "b"], 300);
    expect(isIssueUpdateUnread("a", 299)).toBe(false);
    expect(isIssueUpdateUnread("b", 299)).toBe(false);
    expect(isIssueUpdateUnread("c", 1)).toBe(true);
  });
});
