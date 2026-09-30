import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IssueSessionHeader } from "../../src/components/issue/IssueSessionHeader";

describe("IssueSessionHeader", () => {
  it("renders title and planning/execution tabs", () => {
    const onTabChange = vi.fn();
    render(
      <IssueSessionHeader
        title="设计评审"
        activeTab="planning"
        onTabChange={onTabChange}
        showTabs
        executionEnabled
      />,
    );
    expect(screen.getByTestId("issue-session-title")).toHaveTextContent(
      "设计评审",
    );
    expect(screen.getByTestId("issue-session-tabs")).toHaveClass(
      "issue-session-segmented",
    );
    fireEvent.click(screen.getByTestId("issue-session-tab-execution"));
    expect(onTabChange).toHaveBeenCalledWith("execution");
  });

  it("hides tabs for single-agent issue", () => {
    render(
      <IssueSessionHeader
        title="单 Agent"
        activeTab="planning"
        onTabChange={() => {}}
        showTabs={false}
        executionEnabled={false}
      />,
    );
    expect(screen.queryByTestId("issue-session-tabs")).not.toBeInTheDocument();
  });
});
