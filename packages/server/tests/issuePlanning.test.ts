import { describe, expect, it } from "vitest";
import {
  PLANNING_CODE_WRITE_DENIED,
  buildIssuePlanningExtra,
  isPlanningDocPath,
  looksLikeSourceMutation,
  planningCodeWriteDecision,
} from "../src/services/issuePlanning.js";

describe("issuePlanning", () => {
  it("treats markdown/text as planning docs and source files as code", () => {
    expect(isPlanningDocPath("docs/plan.md")).toBe(true);
    expect(isPlanningDocPath("/tmp/notes.TXT")).toBe(true);
    expect(isPlanningDocPath("src/App.vue")).toBe(false);
    expect(isPlanningDocPath("pkg/foo.ts")).toBe(false);
    expect(isPlanningDocPath("a.json")).toBe(false);
  });

  it("denies Edit/Write on source and allows docs", () => {
    expect(
      planningCodeWriteDecision("Write", { path: "src/main.ts" }),
    ).toEqual({
      behavior: "deny",
      message: PLANNING_CODE_WRITE_DENIED,
    });
    expect(
      planningCodeWriteDecision("Edit", { file_path: "README.md" }),
    ).toBeNull();
    expect(planningCodeWriteDecision("Read", { path: "src/main.ts" })).toBeNull();
    expect(planningCodeWriteDecision("Write", {})).toEqual({
      behavior: "deny",
      message: PLANNING_CODE_WRITE_DENIED,
    });
    expect(
      planningCodeWriteDecision("Bash", {
        command: "sed -i 's/a/b/' src/main.ts",
      }),
    ).toEqual({
      behavior: "deny",
      message: PLANNING_CODE_WRITE_DENIED,
    });
    expect(
      planningCodeWriteDecision("Bash", { command: "git log -1 --oneline" }),
    ).toBeNull();
  });

  it("looksLikeSourceMutation catches redirects to implementation files", () => {
    expect(looksLikeSourceMutation("echo x > src/a.ts")).toBe(true);
    expect(looksLikeSourceMutation("ls src")).toBe(false);
  });

  it("buildIssuePlanningExtra names the issue and forbids source edits", () => {
    const extra = buildIssuePlanningExtra({
      id: "issue-1",
      title: "测试",
      description: "",
    });
    expect(extra).toContain("Issue ID：issue-1");
    expect(extra).toContain("标题：测试");
    expect(extra).toContain("不要修改产品实现");
    expect(extra).toContain("dispatch");
    expect(extra).toContain("计划");
    expect(extra).toContain("值守");
    expect(extra).toContain("复核");
    expect(extra).toContain("items --done");
    expect(extra).toContain("同一");
    expect(extra).toContain("执行过程");
  });
});
