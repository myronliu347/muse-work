import { describe, expect, it } from "vitest";
import { compileIssueTrigger } from "../../src/components/automation/scheduleUi";

describe("compileIssueTrigger", () => {
  it("keeps tags and priority so editor autosave cannot drop skill filters", () => {
    expect(
      compileIssueTrigger({
        events: ["created", "review"],
        tags: ["ops"],
        priority: "p0",
      }),
    ).toEqual({
      type: "issue",
      events: ["created", "review"],
      tags: ["ops"],
      priority: "p0",
    });
  });
});
