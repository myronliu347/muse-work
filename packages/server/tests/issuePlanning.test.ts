import { describe, expect, it } from "vitest";
import {
  PLANNING_CODE_WRITE_DENIED,
  buildIssuePlanningExtra,
  buildIssueSingleAgentExtra,
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
    expect(extra).toContain("items --done");
    expect(extra).toContain("同一");
    expect(extra).toContain("产物");
    expect(extra).toContain("先跟用户确认做什么");
    expect(extra).toContain("把确认的内容落到文档");
    expect(extra).toContain("写出实施计划文档");
    expect(extra).toContain("给人看的文档要带流程图，用 mermaid 语法，不然看不懂");
    expect(extra).toContain("用户确认实施计划之后，才创建执行清单");
    expect(extra).toContain("用户确认执行清单之后，才开始派发");
    expect(extra).toContain("用户确认条目后再 items --add-json");
    expect(extra).toContain("开始执行/派发后再首次 dispatch");
    expect(extra).toContain("不要擅自写清单或开工");
    expect(extra).toContain("--remove");
  });

  it("buildIssueSingleAgentExtra allows implementing in this session", () => {
    const extra = buildIssueSingleAgentExtra({
      id: "issue-1",
      title: "测试",
      description: "修登录",
    });
    expect(extra).toContain("Issue ID：issue-1");
    expect(extra).toContain("单 agent");
    expect(extra).toContain("修登录");
    expect(extra).not.toContain("不要修改产品实现");
    expect(extra).toContain("不要 dispatch");
    expect(extra).toContain("不要建清单");
    expect(extra).toContain("本会话");
    expect(extra).toContain("issue.mjs");
    expect(extra).toContain("complete");
    expect(extra).toContain("直接在本会话里改代码实现");
    expect(extra).not.toContain("与用户确认需求后");
    expect(extra).toContain("ready");
  });
});
