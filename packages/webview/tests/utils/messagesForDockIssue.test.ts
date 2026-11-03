import { describe, expect, it } from "vitest";
import { messagesForDockIssue } from "../../src/utils/fileHistorySnapshots";

describe("messagesForDockIssue", () => {
  it("keeps the issue transcript after the column is hidden", () => {
    const cached = {
      sessionId: "sess-issue",
      status: "ready" as const,
      messages: [{ id: "m1" }],
    };
    expect(
      messagesForDockIssue({
        sessionId: "sess-issue",
        liveSessionId: "assistant",
        liveMessages: [{ id: "bot" }],
        shownSessionId: undefined,
        shownMessages: [],
        cached,
      }),
    ).toEqual(cached.messages);
  });

  it("prefers the live session when it is still this issue", () => {
    expect(
      messagesForDockIssue({
        sessionId: "sess-issue",
        liveSessionId: "sess-issue",
        liveMessages: [{ id: "live" }],
        shownSessionId: undefined,
        shownMessages: [],
        cached: {
          sessionId: "sess-issue",
          status: "ready",
          messages: [{ id: "old" }],
        },
      }),
    ).toEqual([{ id: "live" }]);
  });
});
