import { describe, expect, it } from "vitest";
import {
  PLANNING_CODE_WRITE_DENIED,
  buildIssuePlanningExtra,
  isPlanningDocPath,
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
  });

  it("buildIssuePlanningExtra names the issue and forbids source edits", () => {
    const extra = buildIssuePlanningExtra({
      id: "issue-1",
      title: "测试",
      description: "",
    });
    expect(extra).toContain("Issue ID：issue-1");
    expect(extra).toContain("标题：测试");
    expect(extra).toContain("禁止 Edit/Write 修改源码");
    expect(extra).toContain("dispatch");
    expect(extra).toContain("写文档");
    expect(extra).toContain("值守");
    expect(extra).toContain("复核");
    expect(extra).toContain("同一");
    expect(extra).toContain("执行过程");
  });
});
