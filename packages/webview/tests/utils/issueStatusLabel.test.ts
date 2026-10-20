import { describe, expect, it } from "vitest";
import { issueSidebarStatusLabel } from "../../src/utils/issueStatusLabel";

describe("issueSidebarStatusLabel", () => {
  it("follows the session for single mode and keeps split labels", () => {
    expect(
      issueSidebarStatusLabel({ status: "planning", agentMode: "single" }),
    ).toBe("空闲");
    expect(
      issueSidebarStatusLabel({
        status: "planning",
        agentMode: "single",
        running: true,
      }),
    ).toBe("进行中");
    expect(
      issueSidebarStatusLabel({
        status: "planning",
        agentMode: "single",
        sessionStatus: "error",
      }),
    ).toBe("失败");
    expect(
      issueSidebarStatusLabel({ status: "awaiting_close", agentMode: "single" }),
    ).toBe("待关闭");
    expect(issueSidebarStatusLabel({ status: "planning", agentMode: "split" })).toBe(
      "规划中",
    );
    expect(issueSidebarStatusLabel({ status: "executing" })).toBe("执行中");
  });
});
